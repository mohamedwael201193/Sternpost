/**
 * Fork setup + verification runner for the MCP server (plan §5.1, task 1.9
 * scope note): the Wave 2 TroveAccount system is NOT deployed on live
 * testnet, so the full success paths are verified on an anvil fork of
 * testnet (FORK=1, nothing broadcast).
 *
 * What it does:
 *  1. Starts `anvil --fork-url https://rpc.test.mezo.org --chain-id 31611`.
 *  2. Reads the live BTC price from testnet, then stubs the PriceFeed
 *     precompile per plan G3 (`anvil_setCode` with the MockPriceFeed
 *     runtime code from the forge build, then `setPrice`).
 *  3. Deploys TroveAccount implementation + TroveAccountFactory + Radar.
 *  4. Creates + opens an account (0.095 BTC collateral, 2100 MUSD debt),
 *     sweeps the borrowed MUSD to the owner (so `pay` must refill),
 *     approves a session for a fresh agent key (budget 10, perTx 5,
 *     daily 5, 7 days, canSignX402) + the demo.vativ.io payee, and
 *     approves Permit2 to spend the account's MUSD.
 *  5. Runs `npm run test:fork` and `npm run smoke` (fork mode) against
 *     the fork, then stops anvil and exits with the test status.
 *
 * Keys: the owner + agent keys are fresh random keys generated here and
 * funded with `anvil_setBalance`. The agent key file is written to
 * /tmp/sternpost-fork-agent.json (NEVER inside the repo); only addresses
 * and tx hashes are written to mcp/evidence/fork-addresses.json.
 *
 * Usage: npm run fork
 * Requires: forge build artifacts in contracts/out (run `forge build` in
 * contracts/ first if missing) and ~/.foundry/bin/anvil on PATH.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  parseEther,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MCP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ANVIL = join(homedir(), ".foundry", "bin", "anvil");
const FORK_PORT = 8545;
const FORK_RPC = `http://127.0.0.1:${FORK_PORT}`;
const LIVE_RPC = "https://rpc.test.mezo.org";

const MEZO = {
  bo: "0xCdF7028ceAB81fA0C6971208e83fa7872994beE5",
  tm: "0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0",
  pf: "0x86bCF0841622a5dAC14A313a15f96A95421b9366",
  musd: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503",
  smusd: "0x6f461c68B2c5492C0F5CCEc5a264d692aA7A8e16",
  st: "0x722E4D24FD6Ff8b0AC679450F3D91294607268fA",
  hintHelpers: "0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
};
const DEMO_PAY_TO = "0xC3376296a18ef364eA19287203EEd7a87f18e738";

const chain = {
  id: 31611,
  name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: [FORK_RPC] } },
  testnet: true,
};

const log = (...a) => console.log("[fork-setup]", ...a);
const toHex = (bn) => `0x${bn.toString(16)}`;
const fail = (msg) => {
  console.error("[fork-setup] FAILED:", msg);
  process.exitCode = 1;
  throw new Error(msg);
};

async function artifact(relPath) {
  const raw = await readFile(join(ROOT, "contracts", "out", relPath), "utf8");
  return JSON.parse(raw);
}

async function rpcCall(method, params) {
  const res = await fetch(FORK_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method} failed: ${JSON.stringify(json.error)}`);
  return json.result;
}

async function waitForAnvil(child, timeoutMs = 60_000) {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(FORK_RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      const json = await res.json();
      if (json.result === "0x7b7b") return; // 31611 in hex
    } catch {
      // not up yet
    }
    if (Date.now() - start > timeoutMs || child.exitCode !== null) {
      fail("anvil did not come up in time");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function main() {
  // 0. Forge artifacts must exist (build them first if needed).
  for (const rel of [
    "TroveAccount.sol/TroveAccount.json",
    "TroveAccountFactory.sol/TroveAccountFactory.json",
    "Radar.sol/Radar.json",
    "Radar.t.sol/MockPriceFeed.json",
  ]) {
    try {
      await readFile(join(ROOT, "contracts", "out", rel), "utf8");
    } catch {
      fail(`missing forge artifact contracts/out/${rel} — run 'forge build' in contracts/ first`);
    }
  }

  // 1. Start anvil (fork of live testnet, chain 31611 so the MCP chain check passes).
  log("starting anvil (fork of testnet)...");
  const anvil = spawn(ANVIL, ["--fork-url", LIVE_RPC, "--chain-id", "31611", "--port", String(FORK_PORT)], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  anvil.stdout.on("data", (d) => process.stdout.write(`[anvil] ${d}`));
  anvil.stderr.on("data", (d) => process.stderr.write(`[anvil] ${d}`));
  // Anvil's stdout is piped through this process's event loop, but the
  // vitest/smoke runs below use blocking spawnSync — while blocked, the
  // loop cannot drain the pipe, so anvil's test-phase output is buffered
  // and lost on exit. Yielding to the loop after each spawn flushes it.
  const drainAnvilOutput = () => new Promise((r) => setTimeout(r, 500));
  let exitCode = 0;
  try {
    await waitForAnvil(anvil);
    const forkBlock = await rpcCall("eth_blockNumber", []);
    log("anvil up at fork block", Number.parseInt(forkBlock, 16));

    const live = createPublicClient({ chain: { ...chain, rpcUrls: { default: { http: [LIVE_RPC] } } }, transport: http(LIVE_RPC) });
    const fork = createPublicClient({ chain, transport: http(FORK_RPC) });

    // Fresh random owner + agent keys (throwaway, fork-only), funded via anvil_setBalance.
    const ownerKey = generatePrivateKey();
    const owner = privateKeyToAccount(ownerKey);
    const agentKey = generatePrivateKey();
    const agent = privateKeyToAccount(agentKey);
    await rpcCall("anvil_setBalance", [owner.address, toHex(parseEther("10"))]);
    await rpcCall("anvil_setBalance", [agent.address, toHex(parseEther("1"))]);
    const ownerWallet = createWalletClient({ account: owner, chain, transport: http(FORK_RPC) });
    const agentKeyPath = "/tmp/sternpost-fork-agent.json";
    await writeFile(agentKeyPath, JSON.stringify({ address: agent.address, privateKey: agentKey }, null, 2) + "\n", { mode: 0o600 });

    // 2. Live price, then stub the PriceFeed precompile (plan G3).
    const price = (await live.readContract({
      address: MEZO.pf,
      abi: parseAbi(["function fetchPrice() view returns (uint256)"]),
      functionName: "fetchPrice",
    }));
    log("live BTC price:", price.toString());
    const mockPf = await artifact("Radar.t.sol/MockPriceFeed.json");
    const mockRuntime = mockPf.deployedBytecode.object;
    if (!mockRuntime || mockRuntime === "0x") fail("MockPriceFeed has no deployed bytecode");
    await rpcCall("anvil_setCode", [MEZO.pf, mockRuntime]);
    const setPriceHash = await ownerWallet.writeContract({
      address: MEZO.pf,
      abi: mockPf.abi,
      functionName: "setPrice",
      args: [price],
      account: owner,
      chain,
    });
    await fork.waitForTransactionReceipt({ hash: setPriceHash });
    const stubbed = await fork.readContract({
      address: MEZO.pf,
      abi: parseAbi(["function fetchPrice() view returns (uint256)"]),
      functionName: "fetchPrice",
    });
    if (stubbed !== price) fail(`price stub mismatch: ${stubbed} != ${price}`);
    log("price feed stubbed at", stubbed.toString());

    // 3. Deploy TroveAccount implementation + Factory + Radar.
    const troveAccount = await artifact("TroveAccount.sol/TroveAccount.json");
    const implHash = await ownerWallet.deployContract({
      abi: troveAccount.abi,
      bytecode: troveAccount.bytecode.object,
      args: [MEZO.bo, MEZO.tm, MEZO.pf, MEZO.musd, MEZO.smusd, MEZO.st, owner.address, 10],
      account: owner,
      chain,
    });
    const implReceipt = await fork.waitForTransactionReceipt({ hash: implHash });
    const implementation = implReceipt.contractAddress;
    log("TroveAccount implementation:", implementation);

    const factoryArt = await artifact("TroveAccountFactory.sol/TroveAccountFactory.json");
    const factoryHash = await ownerWallet.deployContract({
      abi: factoryArt.abi,
      bytecode: factoryArt.bytecode.object,
      args: [implementation, owner.address, 10],
      account: owner,
      chain,
    });
    const factoryReceipt = await fork.waitForTransactionReceipt({ hash: factoryHash });
    const factory = factoryReceipt.contractAddress;
    log("TroveAccountFactory:", factory);

    const radarArt = await artifact("Radar.sol/Radar.json");
    const radarHash = await ownerWallet.deployContract({
      abi: radarArt.abi,
      bytecode: radarArt.bytecode.object,
      args: [MEZO.st, MEZO.tm, MEZO.pf],
      account: owner,
      chain,
    });
    const radarReceipt = await fork.waitForTransactionReceipt({ hash: radarHash });
    const radar = radarReceipt.contractAddress;
    log("Radar:", radar);

    // 4. Hints + createAndOpen (0.095 BTC, 2100 MUSD debt → ICR ~2.9).
    const policy = {
      floorICR: 2_500_000_000_000_000_000n,
      shieldICR: 1_600_000_000_000_000_000n,
      targetICR: 2_000_000_000_000_000_000n,
      bounty: 1_000_000_000_000_000_000n,
      minDebtAhead: 1_000_000_000_000_000_000_000n,
      cooldownBlocks: 20,
    };
    const coll = parseEther("0.095");
    const debt = parseEther("2100");
    const nicr = (await fork.readContract({
      address: MEZO.hintHelpers,
      abi: parseAbi(["function computeNominalCR(uint256 coll, uint256 debt) view returns (uint256)"]),
      functionName: "computeNominalCR",
      args: [coll, debt],
    }));
    const seed = BigInt(Math.floor(Math.random() * 2 ** 32));
    const [approxHint] = (await fork.readContract({
      address: MEZO.hintHelpers,
      abi: parseAbi(["function getApproxHint(uint256 nicr, uint256 numTrials, uint256 seed) view returns (address hintAddress, uint256 diff, uint256 latestRandomSeed)"]),
      functionName: "getApproxHint",
      args: [nicr, 30, seed],
    }));
    const [upHint, loHint] = (await fork.readContract({
      address: MEZO.st,
      abi: parseAbi(["function findInsertPosition(uint256 nicr, address prevId, address nextId) view returns (address, address)"]),
      functionName: "findInsertPosition",
      args: [nicr, approxHint, approxHint],
    }));
    log("hints:", upHint, loHint, "nicr:", nicr.toString());
    const salt = `0x${"0".repeat(63)}1`;
    const createHash = await ownerWallet.writeContract({
      address: factory,
      abi: factoryArt.abi,
      functionName: "createAndOpen",
      args: [salt, policy, debt, upHint, loHint, 1_000_000_000_000_000_000_000n],
      value: coll,
      account: owner,
      chain,
    });
    const createReceipt = await fork.waitForTransactionReceipt({ hash: createHash });
    if (createReceipt.status !== "success") fail(`createAndOpen reverted (tx ${createHash})`);
    const predicted = (await fork.readContract({
      address: factory,
      abi: factoryArt.abi,
      functionName: "predict",
      args: [owner.address, salt, policy],
    }));
    const account = predicted;
    log("TroveAccount:", account, "(createAndOpen tx", createHash + ")");

    // Session + payee + Permit2 approval; sweep the borrowed MUSD so pay must refill.
    const accountAbi = troveAccount.abi;
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 3600);
    const sessionHash = await ownerWallet.writeContract({
      address: account,
      abi: accountAbi,
      functionName: "setSession",
      args: [agent.address, parseEther("10"), parseEther("5"), parseEther("5"), expiry, false, true],
      account: owner,
      chain,
    });
    await fork.waitForTransactionReceipt({ hash: sessionHash });
    const payeeHash = await ownerWallet.writeContract({
      address: account,
      abi: accountAbi,
      functionName: "setPayee",
      args: [agent.address, DEMO_PAY_TO, true],
      account: owner,
      chain,
    });
    await fork.waitForTransactionReceipt({ hash: payeeHash });
    // The account itself must be an allowed payee: pay refills by drawing
    // to self (TroveAccount.sol:491 — "payee == address(this) is the x402
    // pay-by-borrow refill"). Without this the refill draw reverts with
    // PayeeNotAllowed(account) — observed 2026-11-15 on the first fork run.
    const selfPayeeHash = await ownerWallet.writeContract({
      address: account,
      abi: accountAbi,
      functionName: "setPayee",
      args: [agent.address, account, true],
      account: owner,
      chain,
    });
    await fork.waitForTransactionReceipt({ hash: selfPayeeHash });
    const approveHash = await ownerWallet.writeContract({
      address: account,
      abi: accountAbi,
      functionName: "approveToken",
      args: [MEZO.permit2, parseEther("1000000")],
      account: owner,
      chain,
    });
    await fork.waitForTransactionReceipt({ hash: approveHash });
    const musdBalance = (await fork.readContract({
      address: MEZO.musd,
      abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
      functionName: "balanceOf",
      args: [account],
    }));
    log("account MUSD before sweep:", musdBalance.toString());
    if (musdBalance > 0n) {
      const sweepHash = await ownerWallet.writeContract({
        address: account,
        abi: accountAbi,
        functionName: "sweepMusd",
        args: [musdBalance],
        account: owner,
        chain,
      });
      await fork.waitForTransactionReceipt({ hash: sweepHash });
    }
    const afterSweep = (await fork.readContract({
      address: MEZO.musd,
      abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
      functionName: "balanceOf",
      args: [account],
    }));
    log("account MUSD after sweep:", afterSweep.toString());

    // 5. Record addresses (no private keys) and run the fork checks.
    const addresses = {
      forkRpc: FORK_RPC,
      forkBlock: Number.parseInt(forkBlock, 16),
      price: price.toString(),
      implementation,
      factory,
      radar,
      account,
      owner: owner.address,
      agent: agent.address,
      agentKeyFile: agentKeyPath,
      demoPayTo: DEMO_PAY_TO,
      createAndOpenTx: createHash,
      sessionTx: sessionHash,
    };
    await mkdir(join(MCP_DIR, "evidence"), { recursive: true });
    await writeFile(join(MCP_DIR, "evidence", "fork-addresses.json"), JSON.stringify(addresses, null, 2) + "\n");
    log("wrote mcp/evidence/fork-addresses.json");

    const testEnv = {
      ...process.env,
      STERNPOST_FORK_TESTS: "1",
      STERNPOST_RPC_URL: FORK_RPC,
      STERNPOST_ACCOUNT: account,
      STERNPOST_AGENT_KEY_FILE: agentKeyPath,
      STERNPOST_FORK_AGENT: agent.address,
      STERNPOST_RADAR: radar,
      // 300 s per-request timeout: anvil fetches remote state per slot
      // through the public RPC, so one heavy eth_call (the deployed
      // Radar's rank()) can take minutes. With the 30 s default the call
      // is abandoned client-side while anvil keeps executing it, which
      // poisons the following tests (observed 2026-11-15: pay tests then
      // timed out on eth_chainId against an unresponsive anvil).
      STERNPOST_RPC_TIMEOUT_MS: "300000",
    };
    log("running fork tests...");
    const vitest = spawnSync("npx", ["vitest", "run", "test/fork.test.ts"], {
      cwd: MCP_DIR,
      env: testEnv,
      stdio: "inherit",
    });
    await drainAnvilOutput();
    if (vitest.status !== 0) exitCode = vitest.status ?? 1;

    if (exitCode === 0) {
      log("running smoke (fork mode)...");
      const smoke = spawnSync("node", ["scripts/mcp-smoke.mjs"], {
        cwd: MCP_DIR,
        env: { ...testEnv, STERNPOST_FORK: "1" },
        stdio: "inherit",
      });
      await drainAnvilOutput();
      if (smoke.status !== 0) exitCode = smoke.status ?? 1;
    }
  } finally {
    log("stopping anvil...");
    anvil.kill("SIGTERM");
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error("[fork-setup] FAILED:", err?.message ?? err);
  process.exit(1);
});
