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
// flag whose next token is missing (last arg) or starts with "--" is
// treated as missing (default) — that guard is specified and kept.
// Empty values are NEVER "unset": an empty, whitespace-only, or
// invisible-character-only value (zero-width chars, NEL) in either form
// (--rpc=, --out=, --rpc "", --out "", --out " ") is a hard
// error — reject, never silently trim-and-accept. A value starting
// with "=" (--rpc==URL, --out==DIR) is a hard error. Any other token
// (positional, or a single-dash typo such as -rpc) is a hard error:
// error: unexpected argument <token>. The RPC is validated with new URL()
// (http:/https: only) before first use, so an invalid URL fails cleanly,
// never with a stack. RPC failures at runtime are caught and reported as a
// clean error, never a stack trace.
const USAGE = `Usage: node scripts/muster-report.mjs [--rpc URL | --rpc=URL] [--out DIR | --out=DIR]
  Defaults: RPC from shared/deployments/testnet.json, output
  docs/proof/users-<YYYY-MM-DD>.md (re-runnable; same date overwrites).`;
function fail(msg) {
  process.stderr.write(`error: ${msg}\n${USAGE}\n`);
  process.exit(1);
}
function checkValue(flag, value) {
  // Reject values with no visible character. Stripping is test-only — the
  // value itself is never modified — so combining marks inside an
  // otherwise-visible value are unaffected. The strip set is exactly:
  //   \s — White_Space as JS defines it (U+0009–U+000D, U+0020, U+00A0,
  //     U+1680, U+2000–U+200A, U+2028–U+2029, U+202F, U+205F, U+3000,
  //     U+FEFF). NOTE: JS \s does NOT include U+0085 NEL
  //     (/\s/u.test("\u0085") is false in Node); NEL is covered by
  //     \p{Cc} below and listed explicitly in the regex.
  //   \p{Cc} — all control code points (C0 U+0000–U+001F, DEL U+007F,
  //     C1 U+0080–U+009F, incl. U+0085 NEL)
  //   \p{Cf} — format chars (U+200B–U+200F, U+202A–U+202E, U+2060–U+2064,
  //     U+061C, U+180E, U+FEFF, U+E0001, U+E0020–U+E007F, ...).
  //     U+E0000 is Cn, not Cf — Cf in that block starts at U+E0001.
  //   \p{Co} — Private Use (137,468 code points: BMP PUA U+E000–U+F8FF,
  //     PUA-A U+F0000–U+FFFFD, PUA-B U+100000–U+10FFFD). PUA has no
  //     Unicode-defined blank rendering and its display is font-dependent,
  //     so a PUA-only value is rejected like every other blank-rendering
  //     class rather than trusted.
  //   \p{Mn} / \p{Me} — non-spacing / enclosing marks (variation selectors
  //     U+FE00–U+FE0F, U+034F, U+17B4–U+17B5, ...)
  //   explicit code points no property covers, or that render blank
  //     despite a visible category: U+00AD soft hyphen (Cf, listed
  //     explicitly), U+115F–U+1160, U+3164, U+FFA0 (Hangul fillers, Lo),
  //     U+2800 braille pattern blank and U+FFFC object replacement
  //     character (So — they render as blank, not as symbols).
  // A value made solely of any of these would otherwise pass and create a
  // directory whose name renders empty. Verified by a full-code-point sweep
  // over all 1,114,112 code points: zero genuinely-invisible survivors.
  // Survivors are exactly three classes: visible characters; unassigned
  // (Cn) code points, which render as a missing-glyph box, not as blank
  // (that includes the 66 Cn noncharacters — U+FDD0–U+FDEF plus U+FFFE /
  // U+FFFF at each plane end — which survive the strip and render as a
  // .notdef missing-glyph box on standard stacks; zero of 1,849 installed
  // fonts define a glyph for the sampled ones, and that rendering is
  // font-dependent); and surrogates (Cs, 2,048), which are not encodable
  // in UTF-8 argv at all.
  if (value.replace(/[\s\p{Cc}\p{Cf}\p{Co}\p{Mn}\p{Me}\u00AD\u0085\u115F-\u1160\u2800\u3164\uFFA0\uFFFC]/gu, "") === "") {
    fail(`invalid value for ${flag}: ${flag} requires a non-empty value`);
  }
  if (value.startsWith("=")) {
    fail(`invalid value for ${flag}: value must not start with '='`);
  }
  return value;
}
let rpcArg;
let outArg;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--rpc" || a === "--out") {
    const next = args[i + 1];
    if (next === undefined || next.startsWith("--")) continue; // missing value -> default
    if (a === "--rpc") rpcArg = checkValue(a, next);
    else outArg = checkValue(a, next);
    i++;
  } else if (a.startsWith("--rpc=")) {
    rpcArg = checkValue("--rpc", a.slice("--rpc=".length));
  } else if (a.startsWith("--out=")) {
    outArg = checkValue("--out", a.slice("--out=".length));
  } else if (a.startsWith("--")) {
    fail(`unknown flag ${a}`);
  } else {
    fail(`unexpected argument ${a}`);
  }
}
const RPC = rpcArg || DEPLOYMENTS.rpc;
let rpcUrl;
try {
  rpcUrl = new URL(RPC);
} catch {
  fail("invalid value for --rpc: not a valid URL");
}
if (rpcUrl.protocol !== "http:" && rpcUrl.protocol !== "https:") {
  fail("invalid value for --rpc: must use http: or https:");
}
const FACTORY = DEPLOYMENTS.sternpost.SternpostFactory.address;
const FACTORY_BLOCK = DEPLOYMENTS.sternpost.SternpostFactory.block;
const GOVERNOR = DEPLOYMENTS.sternpost.governor;
const GOVERNOR_BLOCK = DEPLOYMENTS.sternpost.classicRedeploy.governor.block;
const EXPLORER = DEPLOYMENTS.explorer;
// The report is stamped "Mezo testnet 31611" — 31611 decimal = 0x7b7b.
const EXPECTED_CHAIN_ID = 31611;

async function rpc(method, params) {
  // 15 s timeout: without a signal a stalled / unresolvable RPC hangs
  // forever instead of failing cleanly.
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`RPC ${method}: ${JSON.stringify(json.error)}`);
  return json.result;
}

// A block number / chain id must be a 0x hex string. parseInt(null, 16) /
// parseInt("0x", 16) is NaN, which previously sailed through and
// published a false "0 outside addresses" report stamped "latest NaN".
// hexToInt throws on anything else, so callers inside the try fail cleanly.
// The 0x prefix is matched case-insensitively ("0X7B7B" is the same value
// as "0x7b7b") so hex casing variants never false-fail.
const isHex = (h) => typeof h === "string" && /^0[xX][0-9a-fA-F]+$/.test(h);
const hexToInt = (h) => {
  if (!isHex(h)) throw new Error(`invalid hex value: ${JSON.stringify(h)}`);
  return parseInt(h.slice(2), 16);
};
const topicAddr = (t) => ("0x" + t.slice(-40)).toLowerCase();

// Every log the RPC returns must carry the fields the report reads, in
// the exact shape the real events emit — a type check is not enough:
// topics[1] = "" or "0x12" used to pass (string check only) and topicAddr's
// blind .slice(-40) then yielded "0x" / "0x12", counted as an outside
// address in the published report. Real shapes (verified against
// contracts/src/SternpostFactory.sol:36-37 and
// contracts/src/SternpostGovernor.sol:82):
//   GovernorCreated(address indexed borrower, ...) — 1 indexed param,
//     exactly 2 topics; topics[1] = borrower address topic.
//   SpendWalletCreated(address indexed owner, ...) — 1 indexed param,
//     exactly 2 topics; topics[1] = owner address topic.
//   Drawn(address indexed app, address indexed payee, ...) — 2 indexed
//     params, exactly 3 topics; topics[1] = app address topic.
// topics[0] must be one of the three known signatures (an arbitrary
// topics[0] string was silently classified as SpendWalletCreated), every
// topic must be a full 32-byte word, and transactionHash must be a full
// 32-byte hash (an arbitrary non-empty string rendered a bogus explorer
// link). The 0x prefix is matched case-insensitively ("0X..." is the same
// value as "0x..."), consistent with isHex/hexToInt above — real nodes
// return lowercase "0x", but casing variants never false-fail the shape
// check. (topics[0] itself is still matched against the lowercase known
// signatures; a node returning "0X"-prefixed topics[0] would fail the
// unknown-event-topic check, which is the correct outcome for a response
// no real node produces.) Validate first, fail cleanly — never publish a
// false address.
const TOPIC = /^0[xX][0-9a-fA-F]{64}$/;
const TX_HASH = /^0[xX][0-9a-fA-F]{64}$/;
const EXPECTED_TOPICS = {
  [TOPICS.GovernorCreated]: 2,
  [TOPICS.SpendWalletCreated]: 2,
  [TOPICS.Drawn]: 3,
};
function validateLog(l, expectedAddress) {
  if (!l || typeof l !== "object") throw new Error("malformed log: not an object");
  // The log must come from the contract this query asked about: the RPC
  // was called with an address filter, so a log carrying any other address
  // (or none) is a lying / misrouted response — fail cleanly, never count
  // it. The two getLogs calls query different contracts, so the caller
  // passes the address it queried (factory for creations, governor for draws).
  if (typeof l.address !== "string" || l.address.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error(
      `malformed log: address must be ${expectedAddress}, got ${JSON.stringify(l.address)}`
    );
  }
  if (!Array.isArray(l.topics) || l.topics.length < 2) {
    throw new Error("malformed log: topics must have at least 2 entries");
  }
  if (!Object.hasOwn(EXPECTED_TOPICS, l.topics[0])) {
    throw new Error(`malformed log: unknown event topic ${JSON.stringify(l.topics[0])}`);
  }
  if (l.topics.length !== EXPECTED_TOPICS[l.topics[0]]) {
    throw new Error(
      `malformed log: ${l.topics[0]} must have exactly ${EXPECTED_TOPICS[l.topics[0]]} topics, got ${l.topics.length}`
    );
  }
  for (const t of l.topics) {
    if (typeof t !== "string" || !TOPIC.test(t)) {
      throw new Error(`malformed log: topic must be a 32-byte hex word, got ${JSON.stringify(t)}`);
    }
  }
  // topics[1] is an ABI-encoded address: the upper 12 bytes must be zero.
  // A non-zero-padded topics[1] is not a real indexed-address topic; its
  // low 20 bytes would be counted as a bogus address.
  if (l.topics[1].slice(2, 26) !== "0".repeat(24)) {
    throw new Error(
      `malformed log: topics[1] is not a zero-padded address topic, got ${JSON.stringify(l.topics[1])}`
    );
  }
  if (typeof l.transactionHash !== "string" || !TX_HASH.test(l.transactionHash)) {
    throw new Error(`malformed log: transactionHash must be a 32-byte hex hash, got ${JSON.stringify(l.transactionHash)}`);
  }
  if (!isHex(l.blockNumber)) {
    throw new Error(`malformed log: missing or invalid blockNumber ${JSON.stringify(l.blockNumber)}`);
  }
}

// Windowed eth_getLogs (testnet RPCs cap ranges; 2,000 blocks per call).
// Cap: at most MAX_WINDOWS windows per query, checked BEFORE the first
// eth_getLogs call. Without it an absurd-but-valid-hex latest (e.g.
// 0xFFFFFFFFFFFFFFFF) makes the window loop effectively unbounded —
// astronomical sequential RPC calls, each 15 s-bounded but total
// unbounded. Arithmetic: 100,000 windows x 2,000 blocks = 200M blocks,
// ~12.7 years of chain growth at ~2 s/block. The legitimate window count
// is (latest − FACTORY_BLOCK)/2000 + 1 and grows only ~21.6 windows/day,
// so no legitimate daily run reaches the cap for ~12 years after the 0.9
// deploy. A tighter cap would false-fail: e.g. 1,000 windows = 2M blocks
// ≈ 46 days of growth, and 10,000 windows = 20M blocks ≈ 463 days —
// both inside a year of the deploy. The cap stays 100,000: bounded, not
// unbounded — worst case is MAX_WINDOWS calls per query, each 15 s-bounded
// (100,000 x 15 s = 1,500,000 s ≈ 17 days per query, ≈ 34 days for both
// queries, in the pathological all-stalled case against a lying,
// user-chosen RPC — not "hours"). Any absurd value fails before the first
// eth_getLogs call (after only the eth_chainId + eth_getCode +
// eth_blockNumber reads), with zero eth_getLogs calls.
const MAX_WINDOWS = 100000;
async function getLogs(address, topics, fromBlock, toBlock) {
  const out = [];
  const STEP = 2000;
  const windows = Math.ceil((toBlock - fromBlock + 1) / STEP);
  if (windows > MAX_WINDOWS) {
    throw new Error(
      `refusing eth_getLogs range of ${windows} windows (${fromBlock}–${toBlock}): exceeds cap of ${MAX_WINDOWS} windows`
    );
  }
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
    if (!Array.isArray(logs)) {
      throw new Error("RPC eth_getLogs: result is not an array");
    }
    out.push(...logs);
  }
  return out;
}

const date = new Date().toISOString().slice(0, 10);

const rows = []; // {address, kind, tx, block}
const seen = new Set();
function add(address, kind, tx, block) {
  const a = address.toLowerCase();
  rows.push({ address: a, kind, tx, block, team: TEAM.has(a) });
  seen.add(a);
}

// All top-level RPC work AND the row building that reads the RPC
// results are wrapped, so a refused / unreachable / erroring RPC —
// or a malformed log (short topics, missing transactionHash or
// blockNumber) — fails cleanly (error: RPC request failed: <cause>),
// never with an uncaught stack trace. Previously the try/catch
// covered only the awaits; processing ran outside it and crashed.
let latest;
let creations;
let draws;
try {
  // Chain guard, BEFORE any getLogs call: verify the RPC is actually Mezo
  // testnet 31611 (eth_chainId must be 0x7b7b). The block floor below only
  // catches a LOWER chain — a typo'd --rpc pointing at Ethereum mainnet,
  // BSC, or Mezo mainnet has a HIGHER head, so both getLogs calls would
  // return [] and the script would publish a vacuous "0 outside addresses"
  // report stamped as Mezo testnet 31611. The comparison is numeric (via
  // hexToInt), so hex casing variants ("0x7B7B", "0X7b7b") do not
  // false-fail; a malformed / null chainId fails cleanly via hexToInt
  // instead of crashing. The RPC URL itself is never echoed in any error
  // message (it may contain an API key) — the message names the expected
  // chain instead, so a wrong --rpc user gets the hint without a leak.
  const chainId = hexToInt(await rpc("eth_chainId", []));
  if (chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(
      `RPC chain id ${chainId} is not Mezo testnet 31611 (expected chain id ${EXPECTED_CHAIN_ID}, 0x7b7b) — check --rpc points at Mezo testnet 31611`
    );
  }

  // Deployment-presence check, BEFORE any getLogs call: the chainId guard
  // only proves the RPC CLAIMS chain 31611. A fresh / reset testnet, or
  // any chain reusing chainId 31611, would still return [] from both
  // getLogs calls and the script would publish a vacuous "0 outside
  // addresses" report stamped as Mezo testnet 31611. eth_getCode proves
  // the 0.9 deployment actually exists at the queried addresses: both the
  // factory and the governor must return non-empty code (anything other
  // than "0x" — the actual returned value is used, not a prefix check).
  // A null / non-string / malformed code fails the same way as empty.
  // The RPC URL is never echoed here (it may contain an API key); the
  // message names the expected chain and the address with no code.
  // Boundary: this cannot close a PERFECT REPLAY (same deployer, same
  // nonces, same addresses, zero events yet) — that is indistinguishable
  // from "genuinely zero users" and is out of scope. The fresh-chain /
  // reset / wrong-31611-endpoint case is what this closes.
  for (const [name, addr] of [
    ["SternpostFactory", FACTORY],
    ["SternpostGovernor", GOVERNOR],
  ]) {
    const code = await rpc("eth_getCode", [addr, "latest"]);
    if (typeof code !== "string" || code === "0x") {
      throw new Error(
        `no contract code at ${name} ${addr} on Mezo testnet 31611 — check --rpc points at Mezo testnet 31611 with the 0.9 deployment`
      );
    }
  }

  latest = hexToInt(await rpc("eth_blockNumber", []));

  // latest must not predate either deploy block: a valid-hex latest
  // below the factory/governor block makes both getLogs loops execute
  // zero iterations and publishes a vacuous "0 outside addresses"
  // report. Reachable via a lagging node, an --rpc pointed at a
  // different/lower chain, or a fresh local node — fail cleanly instead.
  // (The RPC URL is not echoed here either; the expected chain is named.)
  if (latest < FACTORY_BLOCK || latest < GOVERNOR_BLOCK) {
    throw new Error(
      `latest block ${latest} is below the deploy blocks (factory ${FACTORY_BLOCK}, governor ${GOVERNOR_BLOCK}) on Mezo testnet 31611 — check --rpc points at Mezo testnet 31611`
    );
  }

  // GovernorCreated + SpendWalletCreated from the 0.9 Factory.
  creations = await getLogs(
    FACTORY,
    [[TOPICS.GovernorCreated, TOPICS.SpendWalletCreated]],
    FACTORY_BLOCK,
    latest
  );
  // Drawn from the 0.9 Governor.
  draws = await getLogs(
    GOVERNOR,
    [[TOPICS.Drawn]],
    GOVERNOR_BLOCK,
    latest
  );

  for (const l of creations) {
    validateLog(l, FACTORY);
    const kind = l.topics[0] === TOPICS.GovernorCreated ? "GovernorCreated" : "SpendWalletCreated";
    add(topicAddr(l.topics[1]), kind, l.transactionHash, hexToInt(l.blockNumber));
  }
  for (const l of draws) {
    validateLog(l, GOVERNOR);
    add(topicAddr(l.topics[1]), "Drawn(app)", l.transactionHash, hexToInt(l.blockNumber));
  }
} catch (err) {
  fail(`RPC request failed: ${err.message}`);
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
const outPath = path.join(outDir, `users-${date}.md`);
try {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, md);
} catch (err) {
  fail(`cannot write report to ${outPath}: ${err.message}`);
}

console.log(`chain: Mezo testnet 31611 (${RPC})`);
console.log(`blocks: factory ${FACTORY_BLOCK}, governor ${GOVERNOR_BLOCK}, latest ${latest}`);
console.log(`events: ${creations.length} creation, ${draws.length} draw`);
console.log(`outside addresses: ${outside.length}`);
console.log(`team addresses: ${teamCount}`);
for (const a of outside) console.log(`  outside: ${a}`);
for (const a of teamSeen) console.log(`  team: ${a}`);
console.log(`wrote ${outPath}`);
