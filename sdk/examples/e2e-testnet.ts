/**
 * End-to-end on Mezo testnet with the real Mezo contracts. Every step prints a tx hash.
 *   MEZO_TESTNET_PK=0x... npm run e2e
 * The borrower must already have a trove. App / agent / merchant keys are created in $STERNPOST_KEYS (outside the repo).
 */
import fs from "node:fs";
import { createPublicClient, createWalletClient, http, parseEther, formatEther, type Address, type Hex, encodeFunctionData, maxUint256 } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { Sternpost, writePadded, mezoTestnet, testnetAddresses as A, sternpostFactoryAbi, spendWalletAbi, sternpostGovernorAbi, musdRequirements, pay, domain, withdrawTypes, explorerTx } from "../src/index.js";

const rawPk = (process.env.MEZO_TESTNET_PK ?? "").trim();
const pk = (rawPk.startsWith("0x") ? rawPk : `0x${rawPk}`) as Hex;
if (rawPk.length === 0) throw new Error("MEZO_TESTNET_PK not set");
const keysPath = process.env.STERNPOST_KEYS ?? "/workspace/sternpost-secrets/keys.json";
if (!fs.existsSync(keysPath)) {
  fs.mkdirSync(keysPath.replace(/\/[^/]+$/, ""), { recursive: true });
  fs.writeFileSync(keysPath, JSON.stringify({ app: generatePrivateKey(), agent: generatePrivateKey(), merchant: generatePrivateKey() }), { mode: 0o600 });
}
const keys = JSON.parse(fs.readFileSync(keysPath, "utf8"));
const transport = http();
const pub = createPublicClient({ chain: mezoTestnet, transport });
const wc = (k: Hex) => createWalletClient({ chain: mezoTestnet, transport, account: privateKeyToAccount(k) });
const borrower = wc(pk), app = wc(keys.app), agent = privateKeyToAccount(keys.agent), merchant = privateKeyToAccount(keys.merchant).address;
const sp = new Sternpost(pub as never);
const out: Record<string, unknown> = { borrower: borrower.account.address, app: app.account.address, agent: agent.address, merchant };
const txs: { step: string; hash: Hex; status: string }[] = [];

const wait = async (step: string, hash: Hex) => {
  const r = await pub.waitForTransactionReceipt({ hash });
  txs.push({ step, hash, status: r.status });
  console.log(`${r.status === "success" ? "ok  " : "rev "} ${step}  ${explorerTx(hash)}`);
  return r;
};
/** Broadcast a tx that is EXPECTED to revert, with a fixed gas limit so the failure lands on-chain as evidence. */
const expectRevert = async (step: string, w: typeof borrower, to: Address, data: Hex) => {
  const hash = await w.sendTransaction({ to, data, gas: 3_000_000n });
  const r = await wait(step, hash);
  if (r.status !== "reverted") throw new Error(`${step} should have reverted`);
};

const erc20 = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
const sigsWrite = [{ type: "function", name: "withdrawMUSDWithSignature", stateMutability: "nonpayable",
  inputs: [{ type: "uint256" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "bytes" }, { type: "uint256" }], outputs: [] }] as const;

// 0. gas for the app key
if ((await pub.getBalance({ address: app.account.address })) < parseEther("0.0005"))
  await wait("fund app key with gas", await borrower.sendTransaction({ to: app.account.address, value: parseEther("0.001") }));

// 1. governor
let gov = await sp.governorOf(borrower.account.address);
if (!gov) {
  await wait("createGovernor(floor 2.5, defend 1.6)", await sp.createGovernor(borrower, parseEther("2.5"), parseEther("1.6")));
  gov = (await sp.governorOf(borrower.account.address))!;
}
out.governor = gov;
console.log("governor", gov, "ICR", formatEther((await sp.state(gov)).icr));

// 2. spend wallet for the agent
const now = (await pub.getBlock()).timestamp;
let wallets = await pub.readContract({ address: A.factory, abi: sternpostFactoryAbi, functionName: "walletsOf", args: [borrower.account.address] }) as readonly Address[];
if (wallets.length === 0) {
  await wait("createSpendWallet(agent, 30d)", await writePadded(pub as never, borrower, { address: A.factory, abi: sternpostFactoryAbi, functionName: "createSpendWallet", args: [agent.address, now + 30n * 86400n] }));
  wallets = await pub.readContract({ address: A.factory, abi: sternpostFactoryAbi, functionName: "walletsOf", args: [borrower.account.address] }) as readonly Address[];
}
const wallet = wallets[wallets.length - 1];
out.spendWallet = wallet;

// 3. per-app policy: budget 1500, per-draw 1000, payee locked to the spend wallet
await wait("authorizeApp(budget 1500, perDraw 1000, payee=SpendWallet)", await sp.authorizeApp(borrower, gov, { app: app.account.address, budget: parseEther("1500"), perDrawMax: parseEther("1000"), expiry: now + 30n * 86400n, payee: wallet }));

// 4. reserve buffer (for defend) and park part of it in sMUSD
await wait("MUSD.approve(governor)", await writePadded(pub as never, borrower, { address: A.musd, abi: erc20, functionName: "approve", args: [gov, maxUint256] }));
await wait("fund(20 MUSD buffer)", await writePadded(pub as never, borrower, { address: gov, abi: sternpostGovernorAbi, functionName: "fund", args: [parseEther("20")] }));
await wait("parkReserve(5 MUSD -> sMUSD)", await writePadded(pub as never, borrower, { address: gov, abi: sternpostGovernorAbi, functionName: "parkReserve", args: [parseEther("5")] }));

// 5. safe draw
const safe = parseEther("10");
const p = await sp.previewDraw(gov, app.account.address, safe, wallet);
console.log("preview 10 MUSD:", p.reason || "OK", "-", p.text, "ICR after", formatEther(p.icrAfter));
const auth = await sp.authorizeDraw(borrower, gov, safe);
await wait("draw(10 MUSD) by app -> SpendWallet", await sp.requestDraw(app, gov, wallet, auth));

// 6. unsafe draw refused on-chain
const unsafe = parseEther("900");
const pu = await sp.previewDraw(gov, app.account.address, unsafe, wallet);
console.log("preview 900 MUSD:", pu.reason, "-", pu.text);
const ua = await sp.authorizeDraw(borrower, gov, unsafe);
await expectRevert("draw(900 MUSD) refused: Unsafe (below floor)", app, gov, encodeFunctionData({ abi: sternpostGovernorAbi, functionName: "draw", args: [unsafe, wallet, ua.withdrawDeadline, ua.withdrawSig, ua.healDeadline, ua.healSig] }));

// 7. direct bypass: valid borrower signature to the governor, submitted straight to Mezo
const n = await sp.nonceOf(borrower.account.address);
const dl = (await pub.getBlock()).timestamp + 90n;
const bsig = await borrower.signTypedData({ domain: domain(mezoTestnet.id, A.signatures), types: withdrawTypes, primaryType: "WithdrawMUSD", message: { amount: safe, borrower: borrower.account.address, recipient: gov, nonce: n, deadline: dl } });
await expectRevert("direct withdrawMUSDWithSignature bypass blocked", app, A.signatures, encodeFunctionData({ abi: sigsWrite, functionName: "withdrawMUSDWithSignature", args: [safe, borrower.account.address, borrower.account.address, borrower.account.address, gov, bsig, dl] }));

// 8. arm the defend standby
await wait("rearm(5 MUSD standby)", await sp.rearm(borrower, gov, parseEther("5")));

// 9. x402: the agent pays a merchant from the SpendWallet (EIP-1271 + Permit2), facilitator pays gas
await wait("SpendWallet.setBudget(Permit2, 10 MUSD)", await writePadded(pub as never, borrower, { address: wallet, abi: spendWalletAbi, functionName: "setBudget", args: [A.musd, parseEther("10")] }));
const r = await pay({ wallet, agent, publicClient: pub as never, requirements: musdRequirements(merchant, parseEther("0.5")), resource: "https://sternpost.example/api/report" });
console.log("x402 verify:", JSON.stringify(r.verify));
if (!r.settle.success || !r.settle.transaction) throw new Error("x402 settle failed: " + JSON.stringify(r.settle));
await wait("x402 settle 0.5 MUSD SpendWallet -> merchant", r.settle.transaction);
console.log("merchant MUSD", formatEther(await pub.readContract({ address: A.musd, abi: erc20, functionName: "balanceOf", args: [merchant] })));

// 10. revoke with nonce burn, then the old signature is dead
const stale = await sp.authorizeDraw(borrower, gov, safe);
await wait("revoke() + nonce burn (1 wei AddColl)", await sp.revoke(borrower, gov, true));
const st = await sp.state(gov);
console.log("frozen", st.frozen, "standby live", st.standby.live);
await sp.unfreeze(borrower, gov).then((h) => wait("unfreeze()", h));
await expectRevert("draw with pre-revoke signature fails (nonce burned)", app, gov, encodeFunctionData({ abi: sternpostGovernorAbi, functionName: "draw", args: [safe, wallet, stale.withdrawDeadline, stale.withdrawSig, stale.healDeadline, stale.healSig] }));
await wait("rearm() after burn", await sp.rearm(borrower, gov, parseEther("5")));

out.txs = txs;
fs.writeFileSync(process.env.E2E_OUT ?? "e2e-testnet.json", JSON.stringify(out, null, 2));
console.log("done", txs.length, "txs");
