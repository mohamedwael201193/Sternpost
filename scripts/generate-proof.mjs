// generate-proof.mjs — regenerate shared/proof.json from TESTS.json +
// shared/deployments/testnet.json (plan §7.3/§7.4, task 0.8 refresh hook).
// The machine-readable proof record for the submission. No code reads
// shared/proof.json yet — wiring into Proof.tsx/sync-proof is a separate
// pending task (see the `consumers` field this script emits). NEVER
// hand-edit shared/proof.json: re-run this script instead.
//
// Usage:
//   node scripts/generate-proof.mjs            # rebuild shared/proof.json
//   node scripts/generate-proof.mjs --check    # exit 1 if the file on disk
//                                              # differs (ignoring the
//                                              # generatedAt/sourceCommit
//                                              # stamps, which move on
//                                              # every run)
//
// What it derives from live repo files (and FAILS on, rather than faking):
//   - deployments.classic + deployments.defend: shared/deployments/testnet.json
//     (0.9 Classic redeploy, sternpost.classicRedeploy). Addresses are
//     cross-checked between the top-level sternpost.* entries and the
//     classicRedeploy.* entries; a mismatch is a hard error. The factory
//     fee (feeBps/feeRecipient) lives on top-level sternpost.SternpostFactory
//     — classicRedeploy.factory carries only address/tx/block/gasUsed, so
//     reading the fee from there silently yields undefined (JSON drops the
//     keys while addrUrl() stringifies to ".../address/undefined").
//   - tests: TESTS.json (suites, totals, reconciliation). Self-validated
//     the same way scripts/sync-proof.mjs does (totals vs suite sums,
//     reconciliation vs declared counts); a self-inconsistent TESTS.json
//     refuses to generate. testsStale is computed from git: any change
//     under contracts/backend/sdk/app/mcp/keeper/scripts since the commit
//     TESTS.json was generated from (or any uncommitted change there)
//     makes the counts stale. Task 0.8 landed with TESTS.json 54ae7a9
//     (2026-11-16); sources have moved since, so testsStale is true
//     again until the next `make test-all` re-run — a new need, not 0.8's.
//   - accountSuite: the `forge test --match-path "test/account/*"` run on
//     current main (lead-verified at the closeAccount merge, then updated
//     for the Shield-round Factory tests from the TESTS.json run at
//     54ae7a9 — see ACCOUNT_SUITE_PIN.source). The run itself is NOT in
//     TESTS.json as a per-file split (TESTS.json contracts-account is the
//     192/0/5 unit slice of the same pass — see the reconciliation note
//     in the output), so the passed/skipped split is a pinned constant
//     WITH its provenance. What IS reproducible from the tree: the
//     DECLARED count per file, checked here by counting `function test*`
//     in contracts/test/account/*.sol (167 declared = 164 passed +
//     3 skipped, after the Shield-round Factory +3). If the tree drifts,
//     generation FAILS and the operator must re-run the forge command
//     and update the pin.
//   - contracts (TroveAccountFactory / TroveAccount / Batcher / Radar):
//     DEPLOYED to testnet (task 1.9, then the Shield redeploy from main
//     3271231, 2026-11-16 — see deployments.accounts). The script reads
//     their addresses/txs from shared/deployments/testnet.json `accounts`
//     and refuses if that deployment is missing or malformed. The demo
//     account is still BLOCKED on funding, so no production §7.4 flow
//     has run — the proofTable rows stay "not evidenced on main".
//   - proofTable (§7.4 rows): production rows are "not evidenced on main"
//     because no demo-account flow has run (contracts deployed, demo
//     BLOCKED on funding). The LAB evidence cited per row is a
//     pinned constant taken from WAVE2_WIN_PLAN.md §4/§7.3 (full hashes
//     only — the one hash the plan cites truncated, the redemption tx
//     0xff2ca3c4…d95c, stays truncated and is flagged as such; never
//     expand a truncated hash). Lab rows are labelled "lab, not Wave 2
//     production" in the output.
//
// Honesty rules baked in: testnet only (chain 31611); no mainnet-live
// claims anywhere (fork-tested rows say so); no invented numbers; every
// address/tx/block carries its explorer.test.mezo.org URL. No dependency
// beyond node.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = process.argv.includes("--check");
const EXPLORER = "https://explorer.test.mezo.org";
const CHAIN_ID = 31611;

const txUrl = (h) => `${EXPLORER}/tx/${h}`;
const addrUrl = (a) => `${EXPLORER}/address/${a}`;
const blockUrl = (n) => `${EXPLORER}/block/${n}`;

function readJson(rel) {
  return JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
}

function gitHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

// Guard against the silently-dropped-undefined defect class (J3-F1):
// JSON.stringify drops undefined object values, so a missing required
// field used to vanish from the output while addrUrl(undefined) still
// emitted ".../address/undefined". Walk the finished proof record and
// FAIL (non-zero exit, in both write and --check mode) if any value is
// undefined, any string contains "undefined", or any emitted URL ends
// in "/undefined" or "/null" (the addrUrl(null)/txUrl(null) variant).
// Legitimate nulls (undeployed addresses, no-tx lab rows) are values,
// not URLs, and pass this check.
function assertNoUndefined(value, path = "proof") {
  if (value === undefined) {
    console.error(`generate-proof: REFUSING — ${path} is undefined (a required field was not set)`);
    process.exit(1);
  }
  if (typeof value === "string") {
    if (value.includes("undefined")) {
      console.error(`generate-proof: REFUSING — ${path} contains "undefined": ${value}`);
      process.exit(1);
    }
    if (/^https?:\/\/.*\/(undefined|null)$/.test(value)) {
      console.error(`generate-proof: REFUSING — ${path} is a broken URL: ${value}`);
      process.exit(1);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoUndefined(v, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) assertNoUndefined(v, `${path}.${k}`);
  }
}

// "2379108551208365491" (1e18 scale) -> "2.379108551208365491".
function scale18(raw) {
  const v = BigInt(raw);
  const whole = v / 1000000000000000000n;
  const frac = (v % 1000000000000000000n).toString().padStart(18, "0").replace(/0+$/, "");
  return frac === "" ? whole.toString() : `${whole}.${frac}`;
}

function musd(raw) {
  return scale18(raw);
}

// Count declared `invariant_*` properties in the tree (forge reports one
// executed entry per invariant contract, so the distinct-declared total
// adds properties-minus-contracts). Directories are the two that hold
// invariant contracts; comments are stripped so a commented-out
// invariant is never counted.
function countInvariantProperties() {
  let n = 0;
  const files = ["contracts/test/account/Invariant.t.sol"];
  try {
    for (const f of readdirSync(join(ROOT, "contracts/test/invariant")).filter((x) => x.endsWith(".t.sol"))) {
      files.push(`contracts/test/invariant/${f}`);
    }
  } catch {
    // No invariant dir: count only the account file (0 if it is absent too).
  }
  for (const rel of files) {
    let text;
    try {
      text = readFileSync(join(ROOT, rel), "utf8");
    } catch {
      continue;
    }
    const clean = text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");
    n += (clean.match(/function\s+invariant_\w*\s*\(/g) ?? []).length;
  }
  return n;
}

// --- TESTS.json: self-validation (mirrors scripts/sync-proof.mjs) --------
function validateTests(tests) {
  const problems = [];
  const completed = tests.suites.filter((s) => s.kind !== "fork" && s.status === "completed");
  const sum = (k) => completed.reduce((n, s) => n + (s[k] ?? 0), 0);
  if (tests.total?.passed !== sum("passed"))
    problems.push(`total.passed=${tests.total?.passed} != sum of completed non-fork suites passed=${sum("passed")}`);
  if (tests.total?.failed !== sum("failed"))
    problems.push(`total.failed=${tests.total?.failed} != sum of completed non-fork suites failed=${sum("failed")}`);
  if (tests.total?.skipped !== sum("skipped"))
    problems.push(`total.skipped=${tests.total?.skipped} != sum of completed non-fork suites skipped=${sum("skipped")}`);
  const rec = tests.reconciliation;
  if (rec) {
    const declared = sum("passed") + sum("failed") + sum("skipped");
    if (rec.nonForkDeclared !== declared)
      problems.push(`reconciliation.nonForkDeclared=${rec.nonForkDeclared} != completed non-fork declared=${declared}`);
    const testnet = tests.suites.find((s) => s.name === "contracts-fork-testnet");
    if (testnet?.status === "completed") {
      const testnetDeclared = testnet.passed + testnet.failed + testnet.skipped;
      if (rec.forkDeclared !== testnetDeclared)
        problems.push(`reconciliation.forkDeclared=${rec.forkDeclared} != testnet fork declared=${testnetDeclared}`);
      // Distinct fork tests counted ONCE, via the testnet run: the
      // mainnet run's 7 passed names are a strict subset of the
      // testnet run's 10, so adding mainnet.passed double-counts 7
      // (the old formula gave 512; the honest distinct count is 505).
      const inclFork =
        (tests.total?.passed ?? 0) +
        testnet.passed;
      if (rec.passedInclFork !== inclFork)
        problems.push(`reconciliation.passedInclFork=${rec.passedInclFork} != total + testnet fork passed=${inclFork}`);
    }
  }
  if (problems.length > 0) {
    console.error("generate-proof: REFUSING — TESTS.json does not validate against itself: " + problems.join("; "));
    process.exit(1);
  }
}

// Stale iff sources changed since the TESTS.json commit, or are dirty now.
function freshness(tests) {
  const commit = tests.commit;
  const SOURCE_PATHS = ["contracts", "backend", "sdk", "app", "mcp", "keeper", "scripts"];
  if (!commit || !/^[0-9a-f]{40}$/.test(commit)) {
    return { stale: true, reason: `TESTS.json commit "${commit ?? "missing"}" is not a full 40-hex SHA — re-run \`make test-all\`` };
  }
  // The recorded commit may be a work-clone HEAD that never landed on
  // main (TESTS.json on main records 7b1ffcd, which is not in main's
  // history). Fail closed per the sync-proof rule: unknown commit = stale.
  try {
    execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], { cwd: ROOT, stdio: "ignore" });
  } catch {
    return { stale: true, reason: `TESTS.json commit ${commit.slice(0, 7)} is not in this repo's history (work-clone run) — freshness cannot be verified; re-run \`make test-all\`` };
  }
  try {
    const head = gitHead();
    if (!head) return { stale: true, reason: "cannot determine git HEAD — re-run `make test-all`" };
    const changed = execFileSync("git", ["diff", "--name-only", commit, head, "--", ...SOURCE_PATHS], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      // This script's own output (shared/proof.json) is not a source;
      // scripts/generate-proof.mjs itself IS a source (it changes what
      // the numbers mean), so it stays in the diff.
      .filter((l) => l !== "shared/proof.json");
    if (changed.length > 0) {
      return { stale: true, reason: `sources changed since TESTS.json commit ${commit.slice(0, 7)}: ${changed.join(", ")} — re-run \`make test-all\`` };
    }
    const dirty = execFileSync("git", ["status", "--porcelain", "--", ...SOURCE_PATHS], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .map((l) => l.slice(3).trim())
      .filter(Boolean)
      .filter((l) => l !== "shared/proof.json");
    if (dirty.length > 0) {
      return { stale: true, reason: `uncommitted changes under ${SOURCE_PATHS.join("/")} — re-run \`make test-all\` after committing them: ${dirty.slice(0, 5).join(", ")}` };
    }
    return { stale: false, reason: "" };
  } catch (e) {
    return { stale: true, reason: `cannot verify freshness against git (${String(e.message).split("\n")[0]}) — re-run \`make test-all\`` };
  }
}

// --- Account suite: pinned lead-verified run + static declared-count check
const ACCOUNT_SUITE_PIN = {
  source:
    'forge test --match-path "test/account/*" on current main, lead-verified at the closeAccount merge (2026-11-15) and ' +
    "updated for the Shield-round Factory tests from the forge run behind TESTS.json commit 54ae7a9 " +
    "(~/workspace/mezo-wave2/work/ci-fix/out/forge-account.json, 213 entries: FactoryTest 25 unit + 1 fuzz Success, 0 failed; " +
    "no account-test file changed between 54ae7a9 and HEAD, so that run covers this tree). " +
    "Not re-executed in this work clone: forge-std is not vendored here (no lib/), so `forge test` cannot compile in this tree. " +
    "forge itself IS installed in this VM at ~/.foundry/bin/forge (v1.8.6, commit 6bad0a66), merely not on the default PATH " +
    "— the earlier 'forge is not installed' claim was wrong. Declared counts below are re-checked " +
    "against the tree on every run (count of `function test*` per file).",
  passed: 164,
  failed: 0,
  skipped: 3,
  suites: {
    TroveAccountTest: { file: "TroveAccount.t.sol", passed: 57, failed: 0, skipped: 0 },
    Draw: { file: "TroveAccountDraw.t.sol", passed: 36, failed: 0, skipped: 0 },
    RadarUnit: { file: "Radar.t.sol", passed: 17, failed: 0, skipped: 0 },
    Factory: { file: "Factory.t.sol", passed: 26, failed: 0, skipped: 0 },
    BatcherTest: { file: "Batcher.t.sol", passed: 28, failed: 0, skipped: 1 },
    RadarFork: { file: "Radar.t.sol", passed: 0, failed: 0, skipped: 2, note: "fork tests, skipped offline" },
  },
};

function checkAccountSuitePin() {
  // Count each file ONCE (Radar.t.sol holds two suites: RadarUnit + RadarFork).
  const files = [...new Set(Object.values(ACCOUNT_SUITE_PIN.suites).map((s) => s.file))];
  const declared = {};
  for (const file of files) {
    const text = readFileSync(join(ROOT, "contracts/test/account", file), "utf8");
    declared[file] = (text.match(/function\s+test\w*\s*\(/g) ?? []).length;
  }
  const expected = {
    "TroveAccount.t.sol": 57,
    "TroveAccountDraw.t.sol": 36,
    "Radar.t.sol": 19, // RadarUnit 17 + RadarFork 2 (split comes from the run record)
    "Factory.t.sol": 26, // 22 unit + 1 fuzz at the closeAccount merge, + 3 Shield-round cooldown tests (3271231)
    "Batcher.t.sol": 29, // BatcherTest 28 passed + 1 skipped
  };
  const problems = [];
  for (const [file, want] of Object.entries(expected)) {
    if (declared[file] !== want) {
      problems.push(`${file}: tree declares ${declared[file]} test fns, pin expects ${want}`);
    }
  }
  const pinDeclared = Object.values(ACCOUNT_SUITE_PIN.suites).reduce(
    (n, s) => n + s.passed + s.failed + s.skipped,
    0
  );
  if (pinDeclared !== ACCOUNT_SUITE_PIN.passed + ACCOUNT_SUITE_PIN.failed + ACCOUNT_SUITE_PIN.skipped) {
    problems.push(`pin suites sum to ${pinDeclared} declared, pin totals say ${ACCOUNT_SUITE_PIN.passed + ACCOUNT_SUITE_PIN.failed + ACCOUNT_SUITE_PIN.skipped}`);
  }
  if (problems.length > 0) {
    console.error(
      "generate-proof: REFUSING — account-suite pin no longer matches contracts/test/account/*.sol: " +
        problems.join("; ") +
        '. Re-run `forge test --match-path "test/account/*"` and update ACCOUNT_SUITE_PIN.'
    );
    process.exit(1);
  }
}

// --- §7.4 production proof table ------------------------------------------
// Production rows are "not evidenced on main" because no demo-account flow has run (contracts deployed, demo BLOCKED on funding).
// Lab evidence is pinned from WAVE2_WIN_PLAN.md §4/§7.3 (full hashes only,
// except the redemption tx, which the plan cites truncated — flagged, never
// expanded). Every lab row is labelled "lab, not Wave 2 production".
const PROOF_TABLE = [
  {
    id: "create-open",
    row: "create+open (createAndOpen)",
    status: "not evidenced on main",
    evidenceScope: "lab, not Wave 2 production",
    production: null,
    lab: {
      tx: "0x0a3f4c0de6132f9abb030a8a1a07238ce6e5169cf699e796d9e028906db50545",
      txUrl: txUrl("0x0a3f4c0de6132f9abb030a8a1a07238ce6e5169cf699e796d9e028906db50545"),
      block: 16790703,
      blockUrl: blockUrl(16790703),
      what: "TroveAccount v1 open: 0.06 BTC collateral, 2001.8 MUSD composite principal (NET 1800 MUSD received: 1800 + 1.8 borrowing fee + 200 gas comp), ICR 1.9255 on the composite principal; Mezo EIP-712 nonce stayed 43 before/after (contract is the borrower)",
    },
    note: "Production createAndOpen needs a demo account: contracts are deployed (deployments.accounts) but the demo account is BLOCKED on funding — no production flow has run.",
    source: "WAVE2_WIN_PLAN.md §4.1",
  },
  {
    id: "session-opened",
    row: "session opened",
    status: "not evidenced on main",
    evidenceScope: "lab, not Wave 2 production",
    production: null,
    lab: {
      tx: null,
      what: "Sessions + payee allowlist were set for both lab agents (budget 500, per-tx 100) before the batch draw; no standalone session-open tx is cited in the plan",
      batchTx: "0x6768014f8154ea96c06032a35535d2e3e9bc844bd799922cf0bc3efead05fe31",
      batchTxUrl: txUrl("0x6768014f8154ea96c06032a35535d2e3e9bc844bd799922cf0bc3efead05fe31"),
    },
    note: "Production session-open needs a demo account (contracts deployed; demo BLOCKED on funding).",
    source: "WAVE2_WIN_PLAN.md §4.3 step 1",
  },
  {
    id: "two-agents-draw",
    row: "2 agents draw",
    status: "not evidenced on main",
    evidenceScope: "lab, not Wave 2 production",
    production: null,
    lab: {
      txs: [
        {
          tx: "0xae193088ece52b71170c4821f7ab09737040b516917b91d7748e6f11a238701d",
          txUrl: txUrl("0xae193088ece52b71170c4821f7ab09737040b516917b91d7748e6f11a238701d"),
          block: 16790745,
          blockUrl: blockUrl(16790745),
          what: "Agent 1 drew 60 MUSD",
        },
        {
          tx: "0x690b7e088ca95555cb048c6f06e874656c481549f246daeb73b7b2754862f2e6",
          txUrl: txUrl("0x690b7e088ca95555cb048c6f06e874656c481549f246daeb73b7b2754862f2e6"),
          block: 16790746,
          blockUrl: blockUrl(16790746),
          what: "Agent 2 drew 40 MUSD (adjacent block); sessions spent 60/40 independently",
        },
      ],
    },
    note: "Do NOT claim two independent txs in one block — the lab tried 8 times and the node always put them in consecutive blocks.",
    source: "WAVE2_WIN_PLAN.md §4.2",
  },
  {
    id: "drawbysig-batch",
    row: "drawBySig batch (two-agent Batcher tx)",
    status: "not evidenced on main",
    evidenceScope: "lab, not Wave 2 production",
    production: null,
    lab: {
      tx: "0x6768014f8154ea96c06032a35535d2e3e9bc844bd799922cf0bc3efead05fe31",
      txUrl: txUrl("0x6768014f8154ea96c06032a35535d2e3e9bc844bd799922cf0bc3efead05fe31"),
      block: 16791585,
      blockUrl: blockUrl(16791585),
      gasUsed: 8137583,
      what: "One tx, two Drawn events (60 + 40 MUSD), no owner signature; intentNonce of each agent = 1; sessions spent 60/40",
    },
    note: "Batch limit is 2 draws per tx on testnet (block gas limit 10M; a 6M-limit attempt ran out of gas).",
    source: "WAVE2_WIN_PLAN.md §4.3",
  },
  {
    id: "x402-pay-by-borrow",
    row: "x402 pay-by-borrow to the outside service",
    status: "not evidenced on main",
    evidenceScope: "lab, not Wave 2 production",
    production: null,
    lab: {
      outsideService: "https://demo.vativ.io/",
      borrowTx: "0xc74eb3cf1e24d2963f03fa958c553643791c0a8094b837764b55591b2596154f",
      borrowTxUrl: txUrl("0xc74eb3cf1e24d2963f03fa958c553643791c0a8094b837764b55591b2596154f"),
      borrowBlock: 16791504,
      borrowBlockUrl: blockUrl(16791504),
      settleTx: "0x0b202fa0103e02847758e2bfdb7d429b95958068b75a3b3e57a2c19221946e5f",
      settleTxUrl: txUrl("0x0b202fa0103e02847758e2bfdb7d429b95958068b75a3b3e57a2c19221946e5f"),
      what: "0.001 MUSD paid to demo.vativ.io (Mezo x402 quickstart service); facilitator settled, payer = TroveAccountV2",
      ownMerchant: {
        borrowTx: "0xaa087a2ce640e30cce75f96d6c816e60d2ecf3c31598e0e0af814a6b5be1495f",
        borrowTxUrl: txUrl("0xaa087a2ce640e30cce75f96d6c816e60d2ecf3c31598e0e0af814a6b5be1495f"),
        borrowBlock: 16790934,
        borrowBlockUrl: blockUrl(16790934),
        settleTx: "0x7876c7b74708877c4537ae3652210b36b328146ba28939ed5231dd4dbc47e342",
        settleTxUrl: txUrl("0x7876c7b74708877c4537ae3652210b36b328146ba28939ed5231dd4dbc47e342"),
        what: "Own-merchant variant: 0.6 MUSD JIT borrow, 0.5 MUSD settled to the merchant",
      },
    },
    note: "Borrow happens BEFORE signing (the facilitator settles on its own after funds are held). Mainnet settle NOT exercised.",
    source: "WAVE2_WIN_PLAN.md §4.4",
  },
  {
    id: "shield-by-stranger",
    row: "shield by a stranger",
    status: "not evidenced on main",
    evidenceScope: "lab, not Wave 2 production",
    production: null,
    lab: {
      tx: "0xf6de87bcbc0b745cb62d283d8f696d7c5f6c90b107faca1b6d451d7b8d095f4b",
      txUrl: txUrl("0xf6de87bcbc0b745cb62d283d8f696d7c5f6c90b107faca1b6d451d7b8d095f4b"),
      block: 16790917,
      blockUrl: blockUrl(16790917),
      what: "Random EOA called shield(): unparked 187.4 sMUSD, repaid 185.9 MUSD, ICR 1.4649 → 1.59999, 1 MUSD bounty paid. No signature, no nonce.",
    },
    note: "Policy-line triggered (the oracle precompile cannot be pushed on testnet), disclosed — same disclosure as the Classic defend.",
    source: "WAVE2_WIN_PLAN.md §4.5",
  },
  {
    id: "unsafe-draw-revert",
    row: "unsafe-draw revert",
    status: "not evidenced on main",
    evidenceScope: "lab, not Wave 2 production",
    production: null,
    lab: {
      tx: null,
      what: "Account BELOW_FLOOR revert is fork-tested only (test_floor_blocks_draw, lab/test/Lab.t.sol); no production-account unsafe-draw tx exists",
    },
    classicPrecedent: {
      tx: "0xf3920683b0a0b6a3db2ab9227c747112ecda5aa501ca4c426c3408df7fa19bbf",
      txUrl: txUrl("0xf3920683b0a0b6a3db2ab9227c747112ecda5aa501ca4c426c3408df7fa19bbf"),
      block: 16310267,
      blockUrl: blockUrl(16310267),
      what: "Classic (Wave 1, superseded): draw(900 MUSD) reverted, Unsafe(icrAfter=2.183e18, floor=2.5e18)",
      scope: "Classic Wave-1 deployment, superseded by the 0.9 redeploy — precedent only, not the production account",
    },
    note: "Production unsafe-draw simulation needs a demo account (contracts deployed; demo BLOCKED on funding) — eth_call revert BELOW_FLOOR.",
    source: "WAVE2_WIN_PLAN.md §4.5; shared/deployments/testnet.json liveFlow",
  },
  {
    id: "recovery-mode-fork-test",
    row: "Recovery Mode fork test",
    status: "not evidenced on main",
    evidenceScope: "lab, not Wave 2 production",
    production: null,
    lab: {
      tx: null,
      what: "test_recovery_mode_semantics in lab/test/Lab.t.sol (fork); no named production fork test is mapped in TESTS.json",
    },
    forkSuites: null, // derived in main() from the TESTS.json fork suites (J3-F2); never hardcode the fork strings here
    note: "Production Recovery Mode fork test needs the 1.x fork suite on current main.",
    source: "WAVE2_WIN_PLAN.md §4.5, §7.4",
  },
  {
    id: "revoke",
    row: "revoke",
    status: "not evidenced on main",
    evidenceScope: "lab, not Wave 2 production",
    production: null,
    lab: {
      tx: null,
      what: "Account revokeSession/revokeAll then draw reverts SESSION_INACTIVE is unit/fork-tested only; no production-account revoke tx exists",
    },
    classicPrecedent: {
      revokeTx: "0xf0763cf43766a93d921e3085f6eaa727c0fa6d09047130388a53297b3b0d72eb",
      revokeTxUrl: txUrl("0xf0763cf43766a93d921e3085f6eaa727c0fa6d09047130388a53297b3b0d72eb"),
      revokeBlock: 16310274,
      revokeBlockUrl: blockUrl(16310274),
      drawAfterRevokeTx: "0x1938e4723094d02f1b36b9e100885b7e4833f462d34b8dd75e023a0827b0be6f",
      drawAfterRevokeTxUrl: txUrl("0x1938e4723094d02f1b36b9e100885b7e4833f462d34b8dd75e023a0827b0be6f"),
      drawAfterRevokeBlock: 16310277,
      drawAfterRevokeBlockUrl: blockUrl(16310277),
      what: "Classic (Wave 1, superseded): revoke() + nonce burn, then a draw with the pre-revoke signature reverts BadHeal (nonce burned)",
      scope: "Classic Wave-1 deployment, superseded by the 0.9 redeploy — precedent only, not the production account",
    },
    note: "Production revoke-then-draw revert needs a demo account (contracts deployed; demo BLOCKED on funding).",
    source: "WAVE2_WIN_PLAN.md §7.4; shared/deployments/testnet.json liveFlow",
  },
  {
    id: "claim-collateral",
    row: "claimCollateral",
    status: "not evidenced on main",
    evidenceScope: "lab, not Wave 2 production",
    production: null,
    lab: {
      txTruncated: "0xff2ca3c4…d95c",
      fullHashAvailable: false,
      block: 16791587,
      blockUrl: blockUrl(16791587),
      what: "Redemption incident: a lab minimum trove was redeemed (block 16791587); 0.0105 BTC surplus stranded in CollSurplusPool because the deployed V3 had no claimCollateral() (see contracts/src/account/Batcher.sol:144). No explorer link: the redemption tx hash is truncated in every in-repo record.",
      forkTest: "contracts/test/account/Batcher.t.sol testFork_claimCollateralAfterSimulatedRedemption",
    },
    note: "The redemption tx hash is cited TRUNCATED in the plan — never expand it. The plan §4.6 figures (attempted 1902.9, actual 1901.9 MUSD, 0.0295 BTC sent) and the 'bot' attribution are NOT repeated here: no full hash exists in-repo, so no judge can re-verify them on-chain. Production claimCollateral needs a demo account (contracts deployed; demo BLOCKED on funding) or a fork test only, labelled, if no bot cooperates.",
    source: "WAVE2_WIN_PLAN.md §4.6 (incident only — figures not repeated, see note); Batcher.sol:144 (0.0105 BTC surplus)",
  },
  {
    id: "close",
    row: "closeAccount",
    status: "not evidenced on main",
    evidenceScope: "lab, not Wave 2 production",
    production: null,
    lab: {
      tx: null,
      what: "Fork rehearsal only (lab/mainnet/rehearsal_output2.txt, nothing broadcast): close() 324,307 gas then sweepBtc 29,233 gas returned all collateral",
    },
    note: "Production closeAccount (status 2, BTC/MUSD returned) needs a demo account (contracts deployed; demo BLOCKED on funding).",
    source: "WAVE2_WIN_PLAN.md §3.6",
  },
  {
    id: "smusd-yield",
    row: "sMUSD yield is real (manual on testnet)",
    status: "not evidenced on main",
    evidenceScope: "lab, not Wave 2 production",
    production: null,
    lab: {
      distributeTx: "0xe52099be84a5a5e1f565199e7c47d1f746355dbd1cd320ec80634629ee78a34a",
      distributeTxUrl: txUrl("0xe52099be84a5a5e1f565199e7c47d1f746355dbd1cd320ec80634629ee78a34a"),
      unparkTx: "0x3d11f63b2ee44aa89faac16d60d3be93361128c35f1bda4e7ecbf19f224e8ac4",
      unparkTxUrl: txUrl("0x3d11f63b2ee44aa89faac16d60d3be93361128c35f1bda4e7ecbf19f224e8ac4"),
      what: "PCV.distributeMUSD() moved yieldIndex 163.15398 → 163.17529; unpark(1) returned 1 MUSD + 1.333 MUSD yield",
    },
    note: "Testnet yield is manual (anyone can trigger distributeMUSD); never quote a testnet APY. Mainnet rate is read-only.",
    source: "WAVE2_WIN_PLAN.md §3.10",
  },
  {
    id: "btc-key-owner",
    row: "a Bitcoin key can own and administer an account (headless)",
    status: "not evidenced on main",
    evidenceScope: "lab, not Wave 2 production",
    production: null,
    lab: {
      tx: "0x325e0e96cf6225d331891a0e7b1598b8d0ec6b4235fcfd64caf59dc4ffbe13a8",
      txUrl: txUrl("0x325e0e96cf6225d331891a0e7b1598b8d0ec6b4235fcfd64caf59dc4ffbe13a8"),
      what: "TroveAccountV3 owned by an OrangeKit Safe of a test BTC key",
    },
    note: "Production Bitcoin-wallet owner path needs a demo account (contracts deployed; demo BLOCKED on funding) + the OrangeKit flow.",
    source: "WAVE2_WIN_PLAN.md §7.3",
  },
];

function main() {
  const tests = readJson("TESTS.json");
  const deploy = readJson("shared/deployments/testnet.json");
  validateTests(tests);
  checkAccountSuitePin();

  // --- Deployments (0.9 Classic redeploy) -------------------------------
  const s = deploy.sternpost;
  const cr = s.classicRedeploy;
  if (!cr || cr.verified !== true) {
    console.error("generate-proof: REFUSING — shared/deployments/testnet.json has no verified sternpost.classicRedeploy");
    process.exit(1);
  }
  const crossCheck = [
    [s.SternpostFactory.address, cr.factory.address, "Factory"],
    [s.governor, cr.governor.address, "Governor"],
    [s.spendWallet, cr.spendWallet.address, "SpendWallet"],
    [s.SternpostRouter.address, cr.router.address, "Router"],
  ];
  for (const [a, b, name] of crossCheck) {
    if (a.toLowerCase() !== b.toLowerCase()) {
      console.error(`generate-proof: REFUSING — ${name} address mismatch in testnet.json: ${a} != ${b}`);
      process.exit(1);
    }
  }
  if (cr.factory.tx !== s.SternpostFactory.tx || cr.router.tx !== s.SternpostRouter.tx) {
    console.error("generate-proof: REFUSING — deploy tx mismatch between sternpost.* and sternpost.classicRedeploy.* in testnet.json");
    process.exit(1);
  }
  // The factory fee lives on sternpost.SternpostFactory, NOT under
  // classicRedeploy.factory (which has only address/tx/block/gasUsed).
  // Reading it from classicRedeploy.factory yields undefined and used to
  // ship a broken ".../address/undefined" link (J3-F1). Require it here;
  // assertNoUndefined below is the backstop for the whole record.
  if (typeof s.SternpostFactory.feeBps !== "number" || typeof s.SternpostFactory.feeRecipient !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(s.SternpostFactory.feeRecipient)) {
    console.error("generate-proof: REFUSING — sternpost.SternpostFactory in testnet.json has no usable feeBps/feeRecipient");
    process.exit(1);
  }

  // Task 1.9 landed: the account contracts ARE deployed to testnet
  // (Shield redeploy from main 3271231, 2026-11-16). Read them from
  // testnet.json `accounts` — and refuse if that deployment is missing
  // or malformed, so a dropped key can never silently revert the record
  // to "code+tests only". Radar/Batcher carry verified:false on the
  // Blockscout v2 flag (indexer quirk — same bytecode as the verified
  // 1.9 deployment, source available via v1); their verificationNote is
  // carried through verbatim, never upgraded to true here.
  const acc = deploy.accounts;
  if (!acc || typeof acc !== "object") {
    console.error("generate-proof: REFUSING — shared/deployments/testnet.json has no `accounts` deployment (task 1.9 record missing)");
    process.exit(1);
  }
  for (const name of ["implementation", "factory", "radar", "batcher"]) {
    const c = acc[name];
    if (
      !c ||
      typeof c.address !== "string" ||
      !/^0x[0-9a-fA-F]{40}$/.test(c.address) ||
      typeof c.tx !== "string" ||
      !/^0x[0-9a-fA-F]{64}$/.test(c.tx) ||
      typeof c.block !== "number" ||
      typeof c.gasUsed !== "number" ||
      typeof c.verified !== "boolean"
    ) {
      console.error(`generate-proof: REFUSING — testnet.json accounts.${name} is missing address/tx/block/gasUsed/verified`);
      process.exit(1);
    }
  }
  if (typeof acc.feeBps !== "number" || typeof acc.feeRecipient !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(acc.feeRecipient)) {
    console.error("generate-proof: REFUSING — testnet.json accounts has no usable feeBps/feeRecipient");
    process.exit(1);
  }
  if (!acc.demo || acc.demo.status !== "BLOCKED") {
    console.error("generate-proof: REFUSING — testnet.json accounts.demo is not BLOCKED; a demo account would change every §7.4 row — update this script first");
    process.exit(1);
  }
  for (const f of ["TroveAccountFactory.sol", "TroveAccount.sol", "Batcher.sol", "Radar.sol"]) {
    if (!existsSync(join(ROOT, "contracts/src/account", f))) {
      console.error(`generate-proof: REFUSING — contracts/src/account/${f} missing from the tree`);
      process.exit(1);
    }
  }

  const fresh = freshness(tests);
  const suite = (name) => {
    const s = tests.suites.find((x) => x.name === name);
    return s ? { passed: s.passed, failed: s.failed, skipped: s.skipped, kind: s.kind, status: s.status, ...(s.note ? { note: s.note } : {}) } : null;
  };
  const contractsTotal =
    (suite("contracts-unit")?.passed ?? 0) +
    (suite("contracts-fuzz")?.passed ?? 0) +
    (suite("contracts-invariant")?.passed ?? 0) +
    (suite("contracts-account")?.passed ?? 0) +
    (suite("contracts-fuzz-account")?.passed ?? 0) +
    (suite("contracts-routes")?.passed ?? 0);

  // --- Fork suites: derived, never hardcoded (J3-F2) ----------------------
  // validateTests() above already proved the reconciliation consistent
  // with these suites, so a consistently-tampered TESTS.json propagates
  // here instead of contradicting a hardcoded "10/10". A missing or
  // not-completed fork suite refuses generation rather than faking rows.
  const forkTestnet = suite("contracts-fork-testnet");
  const forkMainnet = suite("contracts-fork-mainnet");
  for (const [name, s] of [
    ["contracts-fork-testnet", forkTestnet],
    ["contracts-fork-mainnet", forkMainnet],
  ]) {
    if (!s || s.status !== "completed") {
      console.error(`generate-proof: REFUSING — TESTS.json has no completed ${name} suite; the forks section cannot be derived`);
      process.exit(1);
    }
  }
  const forkDeclared = (s) => s.passed + s.failed + s.skipped;
  const testnetForkDeclared = forkDeclared(forkTestnet);
  // Display convention, preserved: testnet "passed/declared", mainnet
  // "passed/skipped". Mainnet declared is the shared declared count
  // (reconciliation.forkDeclared, validated == testnet declared): the
  // mainnet suite's own passed+failed+skipped understates it because
  // forge collapses the 3 RouterForkTest tests into 1 skipped setUp entry.
  const forkTestnetStr = `${forkTestnet.passed}/${testnetForkDeclared}`;
  const forkMainnetStr = `${forkMainnet.passed}/${forkMainnet.skipped}`;
  const mainnetForkDeclared = tests.reconciliation.forkDeclared;

  // Totals for notes[3]: derived from the validated reconciliation, so
  // the note can never contradict the tests.* values in the same file.
  // Distinct declared adds the invariant properties forge collapses:
  // each invariant suite executes as 1 entry but declares N properties,
  // so the extra is (properties in the tree) − (invariant suites).
  const totalPassed = tests.total.passed;
  const passedInclFork = tests.reconciliation.passedInclFork;
  const invariantProperties = countInvariantProperties();
  const invariantEntries = tests.suites
    .filter((s) => s.kind === "invariant")
    .reduce((n, s) => n + s.passed + s.failed + s.skipped, 0);
  const invariantExtra = invariantProperties - invariantEntries;
  if (invariantProperties === 0 || invariantExtra < 0) {
    console.error(
      `generate-proof: REFUSING — invariant count implausible (properties=${invariantProperties}, entries=${invariantEntries}) — check countInvariantProperties`
    );
    process.exit(1);
  }
  const distinctDeclared =
    tests.reconciliation.nonForkDeclared + tests.reconciliation.forkDeclared + invariantExtra;
  const distinctDeclaredNote =
    `nonForkDeclared + forkDeclared + ${invariantExtra} (forge counts each invariant suite as 1 executed test; the files declare ${invariantProperties} invariant properties)`;

  // Same defect class (J3-F2) in the §7.4 table: the Recovery Mode row
  // used to cite the fork strings as a hardcoded literal. Derive them
  // so a fork tamper cannot leave this row contradicting forks.*.
  const recoveryRow = PROOF_TABLE.find((r) => r.id === "recovery-mode-fork-test");
  if (!recoveryRow) {
    console.error("generate-proof: REFUSING — PROOF_TABLE is missing the recovery-mode-fork-test row");
    process.exit(1);
  }
  recoveryRow.forkSuites = `TESTS.json fork suites exist (testnet ${forkTestnetStr}, mainnet ${forkMainnetStr}) but do not name a Recovery Mode test — mapping test names is still open (task 0.8 landed with TESTS.json 54ae7a9; the mapping was not part of it)`;

  const head = gitHead();
  const proof = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceCommit: head,
    network: "Mezo testnet",
    chainId: CHAIN_ID,
    explorer: EXPLORER,
    notes: [
      "Testnet only (chain 31611). Sternpost is NOT deployed on mainnet; mainnet rows below are fork-tested, never broadcast.",
      // Conditional (J3-F2): the stale text must never be emitted when
      // testsStale is false — it used to be an unconditional literal.
      // The stale text now carries the live reason (fresh.reason), not
      // the old 1.3/1.6 wording: task 0.8 landed with TESTS.json 54ae7a9
      // (2026-11-16), and staleness since then is sources moving again.
      fresh.stale
        ? `TESTS.json is stale: ${fresh.reason}`
        : "TESTS.json is fresh: no source under contracts/backend/sdk/app/mcp/keeper/scripts changed since the TESTS.json commit and there are no uncommitted changes there; testsStale=false.",
      "Account contracts ARE deployed to testnet (Shield redeploy 2026-11-16, deployments.accounts), but every §7.4 production proof row is still 'not evidenced on main': the demo account is BLOCKED on funding, so no production flow has run. Lab rows are labelled as lab.",
      `total.passed is a NON-FORK subtotal (${totalPassed}). Passed incl. fork is ${passedInclFork}; distinct declared tests are ${distinctDeclared}. Never quote ${totalPassed} as the whole table total.`,
      "Sections the generator schema (v1) does not model — mainnet pilot status, outside-user count (0), fee cap (50 bps), previewDraw fix (commit 511f18b) — live in docs/proof/PROOF_PAGE.md and docs/proof/accounts-2026-11-15.md, not in this file; the 0.9 fee (10 bps) is in deployments.classic; the MCP server (mcp/, TESTS.json mcp 56/0/19) is covered by docs/THREAT_MODEL.md S26.",
    ],
    // F3 disclosure: nothing reads this file yet. Wiring Proof.tsx /
    // sync-proof to it is a separate pending task — until then this
    // record is not any consumer's source of truth.
    consumers: {
      count: 0,
      readers: [],
      note: "No code consumes shared/proof.json yet: app/src/landing/Proof.tsx hardcodes its COUNTS and scripts/sync-proof.mjs reads TESTS.json only. Wiring Proof.tsx and sync-proof to this file is a separate pending task.",
    },
    deployments: {
      classic: {
        factory: {
          address: cr.factory.address,
          addressUrl: addrUrl(cr.factory.address),
          tx: cr.factory.tx,
          txUrl: txUrl(cr.factory.tx),
          block: cr.factory.block,
          blockUrl: blockUrl(cr.factory.block),
          gasUsed: cr.factory.gasUsed,
          blockscoutVerified: true,
          // Fee lives on sternpost.SternpostFactory, NOT classicRedeploy.factory (J3-F1).
          feeBps: s.SternpostFactory.feeBps,
          feeRecipient: s.SternpostFactory.feeRecipient,
          feeRecipientUrl: addrUrl(s.SternpostFactory.feeRecipient),
        },
        governor: {
          address: cr.governor.address,
          addressUrl: addrUrl(cr.governor.address),
          tx: cr.governor.tx,
          txUrl: txUrl(cr.governor.tx),
          block: cr.governor.block,
          blockUrl: blockUrl(cr.governor.block),
          gasUsed: cr.governor.gasUsed,
          blockscoutVerified: true,
          floorICR: cr.governor.floorICR,
          defendICR: cr.governor.defendICR,
          feeBps: cr.governor.feeBps,
          feeRecipient: cr.governor.feeRecipient,
          feeRecipientUrl: addrUrl(cr.governor.feeRecipient),
        },
        spendWallet: {
          address: cr.spendWallet.address,
          addressUrl: addrUrl(cr.spendWallet.address),
          tx: cr.spendWallet.tx,
          txUrl: txUrl(cr.spendWallet.tx),
          block: cr.spendWallet.block,
          blockUrl: blockUrl(cr.spendWallet.block),
          gasUsed: cr.spendWallet.gasUsed,
          blockscoutVerified: true,
          agent: cr.spendWallet.agent,
          agentUrl: addrUrl(cr.spendWallet.agent),
          expiry: cr.spendWallet.expiry,
        },
        router: {
          address: cr.router.address,
          addressUrl: addrUrl(cr.router.address),
          tx: cr.router.tx,
          txUrl: txUrl(cr.router.tx),
          block: cr.router.block,
          blockUrl: blockUrl(cr.router.block),
          gasUsed: cr.router.gasUsed,
          blockscoutVerified: true,
          routesEnabledMask: s.SternpostRouter.routesEnabledMask,
          maxLegs: s.SternpostRouter.maxLegs,
        },
        verificationSource: "judges/VERIFY.md (is_verified: true for all four via Blockscout v2 API; deployed bytecode MATCHes a local forge build)",
        deployer: cr.deployer,
        deployerUrl: addrUrl(cr.deployer),
        date: cr.date,
        task: cr.task,
      },
      defend: {
        tx: cr.defend.tx,
        txUrl: txUrl(cr.defend.tx),
        block: cr.defend.block,
        blockUrl: blockUrl(cr.defend.block),
        caller: cr.defend.caller,
        callerUrl: addrUrl(cr.defend.caller),
        callerNote: cr.defend.callerNote,
        repaidMusd: musd(cr.defend.repaidMUSD),
        repaidMusdWei: cr.defend.repaidMUSD,
        icrBefore: scale18(cr.defend.icrBefore),
        icrBeforeRaw: cr.defend.icrBefore,
        icrAfter: scale18(cr.defend.icrAfter),
        icrAfterRaw: cr.defend.icrAfter,
        trigger: cr.defend.trigger,
        finalState: cr.defend.finalState,
      },
      // Task 1.9 + Shield redeploy (testnet.json `accounts`, validated
      // above). Radar/Batcher carry the Blockscout v2 flag as it reads
      // (false) with the verificationNote verbatim — never upgraded here.
      accounts: {
        task: acc.task,
        date: acc.date,
        deployer: acc.deployer,
        deployerUrl: addrUrl(acc.deployer),
        feeBps: acc.feeBps,
        feeRecipient: acc.feeRecipient,
        feeRecipientUrl: addrUrl(acc.feeRecipient),
        implementation: {
          address: acc.implementation.address,
          addressUrl: addrUrl(acc.implementation.address),
          tx: acc.implementation.tx,
          txUrl: txUrl(acc.implementation.tx),
          block: acc.implementation.block,
          blockUrl: blockUrl(acc.implementation.block),
          gasUsed: acc.implementation.gasUsed,
          blockscoutVerified: acc.implementation.verified,
        },
        factory: {
          address: acc.factory.address,
          addressUrl: addrUrl(acc.factory.address),
          tx: acc.factory.tx,
          txUrl: txUrl(acc.factory.tx),
          block: acc.factory.block,
          blockUrl: blockUrl(acc.factory.block),
          gasUsed: acc.factory.gasUsed,
          blockscoutVerified: acc.factory.verified,
          ...(acc.factory.verificationNote ? { verificationNote: acc.factory.verificationNote } : {}),
        },
        radar: {
          address: acc.radar.address,
          addressUrl: addrUrl(acc.radar.address),
          tx: acc.radar.tx,
          txUrl: txUrl(acc.radar.tx),
          block: acc.radar.block,
          blockUrl: blockUrl(acc.radar.block),
          gasUsed: acc.radar.gasUsed,
          blockscoutVerified: acc.radar.verified,
          ...(acc.radar.verificationNote ? { verificationNote: acc.radar.verificationNote } : {}),
        },
        batcher: {
          address: acc.batcher.address,
          addressUrl: addrUrl(acc.batcher.address),
          tx: acc.batcher.tx,
          txUrl: txUrl(acc.batcher.tx),
          block: acc.batcher.block,
          blockUrl: blockUrl(acc.batcher.block),
          gasUsed: acc.batcher.gasUsed,
          blockscoutVerified: acc.batcher.verified,
          ...(acc.batcher.verificationNote ? { verificationNote: acc.batcher.verificationNote } : {}),
        },
        bytecodeMatch: acc.bytecodeMatch,
        compiler: acc.compiler,
        totalGasUsed: acc.totalGasUsed,
        demo: { status: acc.demo.status, reason: acc.demo.reason },
        previousDeployment: {
          date: acc.previous.date,
          task: acc.previous.task,
          implementation: acc.previous.implementation.address,
          factory: acc.previous.factory.address,
          radar: acc.previous.radar.address,
          batcher: acc.previous.batcher.address,
          source: "docs/proof/accounts-2026-11-15.md (task 1.9 record)",
        },
      },
    },
    tests: {
      source: "TESTS.json",
      testsCommit: String(tests.commit).slice(0, 7),
      testsCommitFull: tests.commit,
      testsGeneratedAt: tests.generatedAt,
      forgeStdHash: tests.inputs?.forgeStdHash ?? null,
      stale: fresh.stale,
      testsStale: fresh.stale,
      staleReason: fresh.stale ? fresh.reason : null,
      total: { passed: tests.total.passed, failed: tests.total.failed, skipped: tests.total.skipped },
      nonForkDeclared: tests.reconciliation.nonForkDeclared,
      forkDeclared: tests.reconciliation.forkDeclared,
      passedInclFork,
      distinctDeclared,
      distinctDeclaredNote,
      contracts: contractsTotal,
      suites: Object.fromEntries(tests.suites.map((x) => [x.name, suite(x.name)])),
      reconciliationNote:
        "total.passed is a NON-FORK subtotal; fork suites are listed separately and never added twice (TESTS.json forkNote).",
    },
    accountSuite: {
      source: ACCOUNT_SUITE_PIN.source,
      passed: ACCOUNT_SUITE_PIN.passed,
      failed: ACCOUNT_SUITE_PIN.failed,
      skipped: ACCOUNT_SUITE_PIN.skipped,
      suites: Object.fromEntries(
        Object.entries(ACCOUNT_SUITE_PIN.suites).map(([name, s]) => [
          name,
          { passed: s.passed, failed: s.failed, skipped: s.skipped, file: `contracts/test/account/${s.file}`, ...(s.note ? { note: s.note } : {}) },
        ])
      ),
      reconciliationNote:
        "Reconciled against TESTS.json (commit 54ae7a9): TESTS.json contracts-account (unit) 192 passed / 0 failed / 5 skipped = " +
        "pin unit 162 (57 + 36 + 17 + 25 Factory unit + 27 Batcher unit) + TroveAccountShieldTest unit 27 + TroveAccountFuzzTest unit 3; " +
        "skipped 5 = pin 3 (Batcher 1 + RadarFork 2) + Shield 1 (testFork_shieldOnLiveMezoPath, fork-gated) + Fork 1 (collapsed setUp skip for 8 testFork_ fns). " +
        "TESTS.json contracts-fuzz-account 15 = pin fuzz 2 (Factory 1 + Batcher 1) + TroveAccountFuzzTest 12 + Shield 1; " +
        "contracts-invariant-account 1 = TroveAccountInvariantTest (10 properties, 1 forge entry). " +
        "Verified from the forge run behind TESTS.json (~/workspace/mezo-wave2/work/ci-fix/out/forge-account.json, 213 entries).",
      staticCheck:
        "Declared counts re-checked against contracts/test/account/*.sol on every generation (167 declared = 164 passed + 3 skipped).",
      // J2-F1 scope (P3 docs): 164 is the six on-main suites (Factory
      // 26 after the Shield-round +3); the independent pre-merge
      // re-execution log also ran Shield's then-14 tests (full run
      // 175/0/3). The artifact is committed at judges/forge-account.json.
      scopeNote:
        "164 = the six account suites on main (TroveAccountTest 57, Draw 36, RadarUnit 17, Factory 26, BatcherTest 28, RadarFork 0 passed / 2 skipped). The independent pre-merge re-execution log also ran Shield's then-14 tests: full run 175 passed / 0 failed / 3 skipped (~/workspace/mezo-wave2/work/acct-suite-1.4.log, outside the repo).",
      artifact:
        "judges/forge-account.json — forge JSON output for the six on-main account suites, copied from the readme-catchup branch at 499f8ae; totals verified from the artifact: 161 Success / 0 Failure / 3 Skipped (pre-Factory-+3; current pin is 164/0/3).",
      fullRunWithUnmergedShield: {
        passed: 175,
        failed: 0,
        skipped: 3,
        shieldSuitePassed: 14,
        log: "~/workspace/mezo-wave2/work/acct-suite-1.4.log (outside the repo)",
      },
    },
    forks: {
      testnet: forkTestnetStr,
      mainnet: forkMainnetStr,
      testnetDetail: { passed: forkTestnet.passed, failed: forkTestnet.failed, skipped: forkTestnet.skipped, declared: testnetForkDeclared },
      mainnetDetail: { passed: forkMainnet.passed, failed: forkMainnet.failed, skipped: forkMainnet.skipped, declared: mainnetForkDeclared },
      mainnetSkippedReason:
        `Router fork skipped: no router on mainnet (forge collapses the 3 RouterForkTest tests into 1 skipped setUp entry; declared count is the testnet suite's ${testnetForkDeclared})`,
      source: "TESTS.json suites contracts-fork-testnet / contracts-fork-mainnet (FORK=1 run)",
      scope: "Fork-tested against live chain state; nothing broadcast on mainnet.",
    },
    contracts: {
      troveAccountFactory: {
        status: "deployed to testnet (Shield redeploy 2026-11-16, from main 3271231); demo account BLOCKED on funding — no production flow has run",
        source: "contracts/src/account/TroveAccountFactory.sol",
        deployedAddress: acc.factory.address,
        deployedAddressUrl: addrUrl(acc.factory.address),
        deployTx: acc.factory.tx,
        deployTxUrl: txUrl(acc.factory.tx),
        deployBlock: acc.factory.block,
        blockscoutVerified: acc.factory.verified,
      },
      troveAccount: {
        status: "deployed to testnet (Shield redeploy 2026-11-16, from main 3271231); demo account BLOCKED on funding — no production flow has run",
        source: "contracts/src/account/TroveAccount.sol",
        deployedAddress: acc.implementation.address,
        deployedAddressUrl: addrUrl(acc.implementation.address),
        deployTx: acc.implementation.tx,
        deployTxUrl: txUrl(acc.implementation.tx),
        deployBlock: acc.implementation.block,
        blockscoutVerified: acc.implementation.verified,
      },
      batcher: {
        status: "deployed to testnet (Shield redeploy 2026-11-16, from main 3271231); demo account BLOCKED on funding — no production flow has run",
        source: "contracts/src/account/Batcher.sol",
        deployedAddress: acc.batcher.address,
        deployedAddressUrl: addrUrl(acc.batcher.address),
        deployTx: acc.batcher.tx,
        deployTxUrl: txUrl(acc.batcher.tx),
        deployBlock: acc.batcher.block,
        blockscoutVerified: acc.batcher.verified,
        ...(acc.batcher.verificationNote ? { verificationNote: acc.batcher.verificationNote } : {}),
      },
      radar: {
        status: "deployed to testnet (Shield redeploy 2026-11-16, from main 3271231); demo account BLOCKED on funding — no production flow has run",
        source: "contracts/src/account/Radar.sol",
        deployedAddress: acc.radar.address,
        deployedAddressUrl: addrUrl(acc.radar.address),
        deployTx: acc.radar.tx,
        deployTxUrl: txUrl(acc.radar.tx),
        deployBlock: acc.radar.block,
        blockscoutVerified: acc.radar.verified,
        ...(acc.radar.verificationNote ? { verificationNote: acc.radar.verificationNote } : {}),
      },
    },
    proofTable: PROOF_TABLE,
    threatModel: {
      threat9: {
        rule: "A stale standby: any other signed action uses the shared nonce",
        evidenceTx: "0xeb4365573f274c75a070facf13186bef3784b59d606e8eddb3ee9220a01b2ff3",
        evidenceTxUrl: txUrl("0xeb4365573f274c75a070facf13186bef3784b59d606e8eddb3ee9220a01b2ff3"),
        block: 16310278,
        blockUrl: blockUrl(16310278),
        scope: "Wave-1 run (Classic, superseded deployment)",
        source: "docs/THREAT_MODEL.md (threat 9) + shared/deployments/testnet.json liveFlow (rearm after burn)",
      },
    },
    classicLiveFlow: {
      deployment: "Wave 1 hardened run (2026-10-23), SUPERSEDED by the 0.9 Classic redeploy above",
      txCount: 16,
      source: "shared/deployments/testnet.json liveFlow + judges/TESTNET_TXS.md",
      keyRows: {
        directBypassBlocked: {
          tx: "0xfd93314cb952bf5542b76fd4fe69de500f88dd061e482170e11a4cc7f90a36e2",
          txUrl: txUrl("0xfd93314cb952bf5542b76fd4fe69de500f88dd061e482170e11a4cc7f90a36e2"),
          block: 16310268,
          blockUrl: blockUrl(16310268),
          revertReason: "Mezo: Sending BTC failed (ActivePool callback rejected by governor.receive gate)",
          what: "direct submission bypass reverts: app submits the borrower signature straight to Mezo (threat-model threat 1)",
        },
        draw: {
          tx: "0xba4eb1299298aa6ad661cb6ed83accc9ed07ff2a42ec1b4576bb3c5f67c71523",
          txUrl: txUrl("0xba4eb1299298aa6ad661cb6ed83accc9ed07ff2a42ec1b4576bb3c5f67c71523"),
          block: 16310265,
          blockUrl: blockUrl(16310265),
          what: "draw(10 MUSD) by app -> SpendWallet",
        },
        unsafeDrawRevert: {
          tx: "0xf3920683b0a0b6a3db2ab9227c747112ecda5aa501ca4c426c3408df7fa19bbf",
          txUrl: txUrl("0xf3920683b0a0b6a3db2ab9227c747112ecda5aa501ca4c426c3408df7fa19bbf"),
          block: 16310267,
          blockUrl: blockUrl(16310267),
          what: "draw(900 MUSD) refused: Unsafe(icrAfter=2.183e18, floor=2.5e18)",
        },
        x402Settle: {
          tx: "0x4833c4a878d7efc6a7d7c47baca8a6901b12dfa7e3ca63d9985a5b565f114140",
          txUrl: txUrl("0x4833c4a878d7efc6a7d7c47baca8a6901b12dfa7e3ca63d9985a5b565f114140"),
          block: 16310272,
          blockUrl: blockUrl(16310272),
          what: "x402 settle 0.5 MUSD SpendWallet -> merchant",
        },
        revoke: {
          tx: "0xf0763cf43766a93d921e3085f6eaa727c0fa6d09047130388a53297b3b0d72eb",
          txUrl: txUrl("0xf0763cf43766a93d921e3085f6eaa727c0fa6d09047130388a53297b3b0d72eb"),
          block: 16310274,
          blockUrl: blockUrl(16310274),
          what: "revoke() + nonce burn (1 wei AddColl)",
        },
        rearmAfterBurn: {
          tx: "0xeb4365573f274c75a070facf13186bef3784b59d606e8eddb3ee9220a01b2ff3",
          txUrl: txUrl("0xeb4365573f274c75a070facf13186bef3784b59d606e8eddb3ee9220a01b2ff3"),
          block: 16310278,
          blockUrl: blockUrl(16310278),
          what: "rearm() after burn (threat-model threat-9 evidence)",
        },
      },
    },
    // P3-only lab txs with no §7.4 row (f627): pinned from the lab tx log.
    // Every status/block below was re-checked live via the Blockscout v2
    // API on 2026-11-15. defendLab is also cited in
    // docs/proof/accounts-2026-11-15.md ask 1; v3Open is cited nowhere in
    // the docs — it lives only here. Do not add lab txs that already have
    // a proofTable row.
    labExtras: {
      defendLab: {
        tx: "0xa876bf24ff8430d0f4099a9b00cd78808db2b5eebf2c70c36417a848be66e791",
        txUrl: txUrl("0xa876bf24ff8430d0f4099a9b00cd78808db2b5eebf2c70c36417a848be66e791"),
        block: 16790797,
        blockUrl: blockUrl(16790797),
        status: "ok",
        icrBefore: "2.2929",
        icrAfter: "2.3392",
        trigger: "policy line raised, NOT a price move",
        what: "lab Classic defend(): policy-line triggered repay, ICR 2.2929 → 2.3392 (lab contract; the 0.9 deployment defend is deployments.defend)",
      },
      v3Open: {
        tx: "0x4577b127e9e85d08916948d6c434b8600be1687f9392c9a507bbfdaf5327208b",
        txUrl: txUrl("0x4577b127e9e85d08916948d6c434b8600be1687f9392c9a507bbfdaf5327208b"),
        block: 16791561,
        blockUrl: blockUrl(16791561),
        status: "ok",
        what: "lab TroveAccountV3 open (lab contract, not the production account)",
      },
    },
  };

  // Backstop for the J3-F1 defect class: refuse rather than emit a
  // record with a silently-dropped field or an ".../undefined" URL.
  // Runs in both write and --check mode.
  assertNoUndefined(proof);

  const out = JSON.stringify(proof, null, 2) + "\n";
  const outPath = join(ROOT, "shared/proof.json");
  if (CHECK) {
    let existing;
    try {
      existing = JSON.parse(readFileSync(outPath, "utf8"));
    } catch {
      console.error("generate-proof: CHECK FAILED — shared/proof.json does not exist or is not valid JSON; run `node scripts/generate-proof.mjs`");
      process.exit(1);
    }
    const norm = (o) => ({ ...o, generatedAt: "CHECK", sourceCommit: "CHECK" });
    if (JSON.stringify(norm(existing)) !== JSON.stringify(norm(proof))) {
      console.error("generate-proof: CHECK FAILED — shared/proof.json drifts from TESTS.json + testnet.json; run `node scripts/generate-proof.mjs` to regenerate");
      process.exit(1);
    }
    console.log(
      `generate-proof: CHECK OK — shared/proof.json matches TESTS.json (commit ${proof.tests.testsCommit}, stale=${proof.tests.testsStale}) + testnet.json`
    );
    process.exit(0);
  }
  writeFileSync(outPath, out);
  console.log(
    `generate-proof: wrote shared/proof.json (sourceCommit ${String(head).slice(0, 7)}, testsCommit ${proof.tests.testsCommit}, testsStale=${proof.tests.testsStale}, ` +
      `tests ${proof.tests.total.passed}/${proof.tests.distinctDeclared} declared, accountSuite ${proof.accountSuite.passed}/${proof.accountSuite.passed + proof.accountSuite.failed + proof.accountSuite.skipped}, ` +
      `proofTable ${PROOF_TABLE.filter((r) => r.status === "not evidenced on main").length}/${PROOF_TABLE.length} rows not evidenced on main)`
  );
}

main();
