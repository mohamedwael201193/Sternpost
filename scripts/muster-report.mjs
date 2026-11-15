// muster-report.mjs — Daily outside-count report (plan §5.4 / §9).
//
// Counts OUTSIDE (third-party, non-team) users ONLY from on-chain events on
// Mezo testnet (chain 31611) emitted by the 0.9 deployment in
// shared/deployments/testnet.json:
//   - GovernorCreated / SpendWalletCreated from SternpostFactory
//     (a borrower/owner who created a governor or spend wallet), and
//   - Drawn from the SternpostGovernor (an app that drew from a governor).
// A TroveAccountFactory is not deployed on testnet yet, so AccountCreated has
// no source contract to query; the script notes that and queries nothing for
// it. Payees are NOT counted as users (they only receive a payment).
//
// Team addresses are the deployer / fee recipient, the lab agents, and the
// 0.9 spend-wallet agent. Extra team addresses can be added with the
// TEAM_ADDRESSES env var (comma-separated, case-insensitive). One person can
// own several addresses; the count is of distinct addresses (sybil caveat).
//
// The TRUE number is reported even when it is zero.
//
// Usage:  node scripts/muster-report.mjs [--rpc URL | --rpc=URL] [--out DIR | --out=DIR]
//   Defaults: RPC from shared/deployments/testnet.json, output
//   docs/proof/users-<YYYY-MM-DD>.md (re-runnable; same date overwrites).
// Requires Node >= 18 (global fetch). No dependencies, no keys, read-only.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEPLOYMENTS = JSON.parse(
  readFileSync(path.join(ROOT, "shared/deployments/testnet.json"), "utf8")
);

// ---- Event topics (keccak256 of the canonical signature; verify with:
// cast keccak "GovernorCreated(address,address,uint256,uint256)") ----
const TOPICS = {
  GovernorCreated:
    "0x7e5a2b253485c3c5a74e31ce6bc454c709e7d6bc732927ae3d803e94c4a69ef6",
  SpendWalletCreated:
    "0xc13589decca30023fa938e872feb2df3c551f5e0e90c0cfbd703c05e20f968f4",
  Drawn: "0x721e98d810223daddf4486ec140512aa992172aabbf0ff57fbdad331ad3883eb",
};

// ---- Team addresses (lowercase). Deployer / fee recipient / borrower,
// lab agents (plan §5.6), 0.9 spend-wallet agent (testnet.json). ----
const TEAM = new Set(
  [
    "0xf76e6b0920e9332ff4410f6dd53f01722abc71a3", // deployer, fee recipient, borrower
    "0xef647815df216c60c061a5c7b6c07e3e45d77ae8", // lab agent 1
    "0x77fa3345c7952e5979aa5f5f2495a158a78023d9", // lab agent 2
    "0x62a4773191747994c0368664ca68bc476897c1d9", // 0.9 spend-wallet agent
    DEPLOYMENTS.sternpost.SternpostFactory.address.toLowerCase(),
    DEPLOYMENTS.sternpost.governor.toLowerCase(),
    DEPLOYMENTS.sternpost.spendWallet.toLowerCase(),
  ].concat(
    (process.env.TEAM_ADDRESSES || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  )
);

// ---- CLI flags: --rpc URL | --rpc=URL, --out DIR | --out=DIR.
// Last occurrence wins. Any other token starting with "--" (unknown flag
// or typo, e.g. --rcp) is a hard error: exit 1 with usage on stderr —
// never silently fall back to the default RPC / output dir. A space-form
// flag whose next token starts with "--" is treated as missing (default).
const USAGE = `Usage: node scripts/muster-report.mjs [--rpc URL | --rpc=URL] [--out DIR | --out=DIR]
  Defaults: RPC from shared/deployments/testnet.json, output
  docs/proof/users-<YYYY-MM-DD>.md (re-runnable; same date overwrites).`;
let rpcArg;
let outArg;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--rpc" || a === "--out") {
    const next = args[i + 1];
    if (next === undefined || next.startsWith("--")) continue; // missing value -> default
    if (a === "--rpc") rpcArg = next;
    else outArg = next;
    i++;
  } else if (a.startsWith("--rpc=")) {
    rpcArg = a.slice("--rpc=".length);
  } else if (a.startsWith("--out=")) {
    outArg = a.slice("--out=".length);
  } else if (a.startsWith("--")) {
    process.stderr.write(`error: unknown flag ${a}\n${USAGE}\n`);
    process.exit(1);
  }
  // any other (non-flag) token is ignored, as before
}
const RPC = rpcArg || DEPLOYMENTS.rpc;
const FACTORY = DEPLOYMENTS.sternpost.SternpostFactory.address;
const FACTORY_BLOCK = DEPLOYMENTS.sternpost.SternpostFactory.block;
const GOVERNOR = DEPLOYMENTS.sternpost.governor;
const GOVERNOR_BLOCK = DEPLOYMENTS.sternpost.classicRedeploy.governor.block;
const EXPLORER = DEPLOYMENTS.explorer;

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`RPC ${method}: ${JSON.stringify(json.error)}`);
  return json.result;
}

const hexToInt = (h) => parseInt(h, 16);
const topicAddr = (t) => ("0x" + t.slice(-40)).toLowerCase();

// Windowed eth_getLogs (testnet RPCs cap ranges; 2,000 blocks per call).
async function getLogs(address, topics, fromBlock, toBlock) {
  const out = [];
  const STEP = 2000;
  for (let from = fromBlock; from <= toBlock; from += STEP) {
    const to = Math.min(from + STEP - 1, toBlock);
    const logs = await rpc("eth_getLogs", [
      {
        address,
        topics,
        fromBlock: "0x" + from.toString(16),
        toBlock: "0x" + to.toString(16),
      },
    ]);
    out.push(...logs);
  }
  return out;
}

const latest = hexToInt(await rpc("eth_blockNumber", []));
const date = new Date().toISOString().slice(0, 10);

// GovernorCreated + SpendWalletCreated from the 0.9 Factory.
const creations = await getLogs(
  FACTORY,
  [[TOPICS.GovernorCreated, TOPICS.SpendWalletCreated]],
  FACTORY_BLOCK,
  latest
);
// Drawn from the 0.9 Governor.
const draws = await getLogs(
  GOVERNOR,
  [[TOPICS.Drawn]],
  GOVERNOR_BLOCK,
  latest
);

const rows = []; // {address, kind, tx, block}
const seen = new Set();
function add(address, kind, tx, block) {
  const a = address.toLowerCase();
  rows.push({ address: a, kind, tx, block, team: TEAM.has(a) });
  seen.add(a);
}
for (const l of creations) {
  const kind = l.topics[0] === TOPICS.GovernorCreated ? "GovernorCreated" : "SpendWalletCreated";
  add(topicAddr(l.topics[1]), kind, l.transactionHash, hexToInt(l.blockNumber));
}
for (const l of draws) {
  add(topicAddr(l.topics[1]), "Drawn(app)", l.transactionHash, hexToInt(l.blockNumber));
}

const outside = [...new Set(rows.filter((r) => !r.team).map((r) => r.address))];
const teamSeen = [...new Set(rows.filter((r) => r.team).map((r) => r.address))];
const teamCount = teamSeen.length;

const md = `# Outside-user count — ${date} (Mezo testnet 31611)

Source: on-chain events only. Generated ${new Date().toISOString()} by
\`scripts/muster-report.mjs\` (re-runnable; same date overwrites this file).

## Result

- **Outside addresses: ${outside.length}**
- Team addresses seen in the same events: ${teamCount}
- Total distinct user addresses seen: ${seen.size}

${outside.length === 0 ? "> **0 outside addresses so far.** No third-party address has created a governor / spend wallet or drawn from one yet." : ""}

## Method

- RPC: ${RPC}; latest block at generation: ${latest}
- \`GovernorCreated\` + \`SpendWalletCreated\` from SternpostFactory \`${FACTORY}\`, blocks ${FACTORY_BLOCK}–${latest}
- \`Drawn\` (app = topic 1) from SternpostGovernor \`${GOVERNOR}\`, blocks ${GOVERNOR_BLOCK}–${latest}
- Payees are not counted as users (they only receive a payment).
- No TroveAccountFactory is deployed on testnet yet, so no \`AccountCreated\`
  events exist to query; the count covers the 0.9 Classic deployment only.
- Team addresses (excluded from the outside count): deployer / fee recipient
  \`0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3\`, lab agents
  \`0xEf647815DF216c60c061a5C7b6c07e3e45D77Ae8\`,
  \`0x77fa3345c7952e5979aa5f5f2495a158a78023d9\`, 0.9 spend-wallet agent
  \`0x62a4773191747994c0368664cA68BC476897c1d9\`, plus the factory / governor /
  spend-wallet contracts themselves. Extra team addresses via \`TEAM_ADDRESSES\`.
- Sybil caveat: one person can own several addresses; the count is of
  distinct addresses. EXP is not money and promises nothing.

## Addresses seen

| address | team | first event | tx | block |
|---|---|---|---|---|
${rows
  .sort((a, b) => a.block - b.block)
  .map(
    (r) =>
      `| \`${r.address}\` | ${r.team ? "team" : "outside"} | ${r.kind} | [${r.tx.slice(0, 10)}…](${EXPLORER}/tx/${r.tx}) | ${r.block} |`
  )
  .join("\n") || "| — | — | no events in range | — | — |"}

## Outside addresses

${outside.map((a) => `- \`${a}\``).join("\n") || "_(none)_"}
`;

const outDir = outArg || path.join(ROOT, "docs/proof");
mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `users-${date}.md`);
writeFileSync(outPath, md);

console.log(`chain: Mezo testnet 31611 (${RPC})`);
console.log(`blocks: factory ${FACTORY_BLOCK}, governor ${GOVERNOR_BLOCK}, latest ${latest}`);
console.log(`events: ${creations.length} creation, ${draws.length} draw`);
console.log(`outside addresses: ${outside.length}`);
console.log(`team addresses: ${teamCount}`);
for (const a of outside) console.log(`  outside: ${a}`);
for (const a of teamSeen) console.log(`  team: ${a}`);
console.log(`wrote ${outPath}`);
