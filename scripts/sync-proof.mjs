// sync-proof.mjs — regenerate the test-count numbers in README.md,
// app/src/landing/Proof.tsx and judges/JUDGES.md from TESTS.json
// (plan §7.1 / task 0.8, C12), and check them without writing.
//
// Usage:
//   node scripts/sync-proof.mjs            # rewrite the numbers in place
//   node scripts/sync-proof.mjs --check    # exit 1 if any number differs
//                                          # (CI drift gate; writes nothing)
//
// What it syncs (the plan's 0.8 surface: README.md:13,125,
// Proof.tsx:6-10, JUDGES.md:14-15, plus the same numbers wherever else
// they appear in those files):
//   README badge            tests-N%20passing        <- total.passed
//   README "N passing (non-fork subtotal; E2E not counted)"
//                                                     <- total.passed
//   README Tests table      per-suite **N passing** / **N/N**
//   Proof.tsx COUNTS        contract / fork / backend / sdk+app rows
//   JUDGES.md table         unit+fuzz+invariant, fork testnet/mainnet, sdk
//
// LABEL HONESTY (J2-F5, plan C12): total.passed is a NON-FORK subtotal,
// so the README line must never read "N in total" — the table sums to
// more once the fork rows are added (198 distinct declared vs 179
// passed non-fork on the pre-merge tree). The line reads "N passing
// (non-fork subtotal; E2E not counted)" and this script logs the
// reconciliation (non-fork declared, fork declared, passed incl. fork)
// from TESTS.json.reconciliation on every run.
//
// What it deliberately does NOT touch:
//   - The parenthetical breakdowns in the README table ("Governor 21 + …").
//     They are hand-written prose owned by the contracts tasks; sync prints
//     a warning listing them so their owners refresh them. The bold headline
//     numbers are what must equal TESTS.json.
//   - The Proof.tsx "Txs in the live testnet flow" row and the README
//     "App E2E (Playwright)" row: Playwright e2e is not run by
//     `make test-all`, so no TESTS.json number exists for them.
//   - Fork rows, when the fork suites in TESTS.json are "not-run": nothing
//     is claimed about a run that did not happen. Write mode leaves them
//     alone and warns; --check FAILS if the rows still claim fork numbers
//     (J3-F6) — a TESTS.json that drops the fork results while README /
//     JUDGES still print 10/10 + 7/7 must never go green.
//   - Fork rows render passed/DECLARED with skipped shown (J3-F7):
//     mainnet reads 7/10 (3 skipped — Router fork skipped: no router on
//     mainnet), because the 3 RouterForkTest tests never ran there (forge
//     collapses them into one skipped setUp entry); the declared count is
//     the testnet suite's passed+failed+skipped. The "(3 skipped — …)"
//     parenthetical is hand prose in README/JUDGES (see below); sync
//     rewrites only the bold N/M.
//
// Honesty guard: sync (write mode) REFUSES to run when TESTS.json has any
// failed test or any suite in "error" status, OR when TESTS.json is stale
// (sources under contracts/backend/sdk/app/mcp/keeper/scripts changed
// since the commit TESTS.json was generated from, or uncommitted changes
// there), OR when TESTS.json does not validate against itself (total /
// reconciliation vs the suites, J3-F5), OR when any of the seven contracts
// suites is not completed (J3-F11: AND, not OR — a not-run contracts
// suite must block the sync, not silently drop its tests).
// Stamping a green "N passing" badge over red or stale counts would be a
// lie; fix the failing suites first, re-run `make test-all`, then sync.
// --check mode FAILS (exit 1) on a red or stale TESTS.json, after still
// reporting drift, so CI can never go green on red/stale numbers: the old
// behaviour (warn about red, exit 0 when numbers matched) let a red
// TESTS.json ship as a passing drift check, and the old workflow path
// filter blinded it to gov-chain/backend merges entirely.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = process.argv.includes("--check");
// Source paths whose changes stale the counts: the code under test, PLUS
// the 0.8 scripts themselves (J3-F9/S4): changing scripts/count-tests.sh
// (RPC URLs, P0 pins, match-paths) changes what the numbers mean, so a
// script change without a re-run must stale the counts exactly like a
// contracts change does.
const SOURCE_PATHS = ["contracts", "backend", "sdk", "app", "mcp", "keeper", "scripts"];
// Files sync-proof itself generates from TESTS.json: changing them does
// NOT stale the counts (they are outputs, not inputs). They must be
// filtered out of the freshness diff/status, or every sync would make
// the next check fail on its own output (Proof.tsx sits under app/).
const GENERATED_FILES = new Set(["README.md", "app/src/landing/Proof.tsx", "judges/JUDGES.md"]);
const notGenerated = (list) =>
  list
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !GENERATED_FILES.has(l));

// Freshness: TESTS.json is fresh iff no file under SOURCE_PATHS changed
// between the commit it was generated from and HEAD, and no uncommitted
// change sits in those paths. Fail closed (stale) when git is unavailable
// or the recorded commit is unknown. Note the commit-landing case works:
// after TESTS.json is committed, HEAD moves but the diff over
// SOURCE_PATHS is empty (the commit only touched TESTS.json / 0.8 files).
//
// SECURITY (J3-F10/S10): the recorded commit comes from TESTS.json, which
// any PR can touch — it is NEVER interpolated into a shell string. All
// git calls go through execFileSync with an argument array, and the
// commit must be a full 40-hex SHA before it is used at all.
//
// GITIGNORED INPUTS (J3-F9/S11): contracts/lib/forge-std is gitignored,
// so `git diff` cannot see it being tampered with. summarize.mjs records
// `inputs.forgeStdHash` (sha256 over contracts/lib/forge-std/src) in
// TESTS.json; when that directory is present here the hash is recomputed
// and must match. When it is absent (fresh checkout, CI drift job) the
// check is SKIPPED, not failed — failing there would break every drift
// check that never bootstrapped forge-std. When TESTS.json carries no
// recorded hash (runs predating the field) the check is likewise skipped
// with a note to re-run `make test-all`.
function hashDir(relDir) {
  const abs = join(ROOT, relDir);
  if (!existsSync(abs)) return null;
  const hash = createHash("sha256");
  const walk = (d) => {
    for (const f of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.isFile()) {
        hash.update(p.slice(abs.length + 1));
        hash.update(readFileSync(p));
      }
    }
  };
  walk(abs);
  return hash.digest("hex");
}

function freshness(tests) {
  const commit = tests.commit;
  if (!commit || commit === "unknown") {
    return { fresh: false, reason: `TESTS.json commit is "${commit ?? "missing"}" — re-run \`make test-all\`` };
  }
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    return { fresh: false, reason: `TESTS.json commit "${String(commit).slice(0, 40)}" is not a full 40-hex SHA — refusing to use it in git commands; re-run \`make test-all\`` };
  }
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    const changed = notGenerated(
      execFileSync("git", ["diff", "--name-only", commit, head, "--", ...SOURCE_PATHS], {
        cwd: ROOT,
        encoding: "utf8",
      })
    );
    if (changed.length > 0) {
      return {
        fresh: false,
        reason:
          `sources changed since TESTS.json commit ${commit.slice(0, 7)}: ` +
          changed.join(", ") +
          " — re-run `make test-all`",
      };
    }
    // git status --porcelain lines carry a 3-char "XY " prefix (" M ",
    // "M  ", "?? "); strip it BEFORE notGenerated — trimming first
    // would eat the leading status space and break the prefix, so a
    // sync's own write to the generated Proof.tsx would read as a
    // stale source change (caught 2026-11-15: check-tests failed on
    // "M app/src/landing/Proof.tsx" right after a green sync).
    const dirty = notGenerated(
      execFileSync("git", ["status", "--porcelain", "--", ...SOURCE_PATHS], {
        cwd: ROOT,
        encoding: "utf8",
      })
        .split("\n")
        .map((l) => l.slice(3))
        .join("\n")
    );
    if (dirty.length > 0) {
      return {
        fresh: false,
        reason:
          "uncommitted changes under " +
          SOURCE_PATHS.join("/") +
          " — re-run `make test-all` after committing them: " +
          dirty.slice(0, 5).join(", "),
      };
    }
    const recordedHash = tests.inputs?.forgeStdHash;
    if (typeof recordedHash === "string" && recordedHash !== "") {
      const currentHash = hashDir("contracts/lib/forge-std/src");
      if (currentHash === null) {
        console.log("sync-proof: NOTE — contracts/lib/forge-std/src absent, forge-std hash check skipped (fresh checkout / CI drift job)");
      } else if (currentHash !== recordedHash) {
        return {
          fresh: false,
          reason: `contracts/lib/forge-std/src changed since TESTS.json was generated (hash ${recordedHash.slice(0, 12)}… != ${currentHash.slice(0, 12)}…) — re-run \`make test-all\``,
        };
      }
    } else {
      console.log("sync-proof: NOTE — TESTS.json carries no inputs.forgeStdHash; re-run `make test-all` to record it");
    }
    return { fresh: true, reason: "" };
  } catch (e) {
    return { fresh: false, reason: `cannot verify freshness against git (${String(e.message).split("\n")[0]}) — re-run \`make test-all\`` };
  }
}

function suite(tests, name) {
  return tests.suites.find((s) => s.name === name);
}
function passed(tests, name) {
  const s = suite(tests, name);
  return s && s.status === "completed" ? s.passed : null;
}
function isCompleted(tests, name) {
  return suite(tests, name)?.status === "completed";
}

function main() {
  const testsPath = join(ROOT, "TESTS.json");
  let tests;
  try {
    tests = JSON.parse(readFileSync(testsPath, "utf8"));
  } catch {
    console.error(`sync-proof: cannot read ${testsPath} — run \`make test-all\` first`);
    process.exit(1);
  }

  const contracts =
    (passed(tests, "contracts-unit") ?? 0) +
    (passed(tests, "contracts-fuzz") ?? 0) +
    (passed(tests, "contracts-invariant") ?? 0) +
    (passed(tests, "contracts-account") ?? 0) +
    (passed(tests, "contracts-fuzz-account") ?? 0) +
    (passed(tests, "contracts-invariant-account") ?? 0) +
    (passed(tests, "contracts-routes") ?? 0);
  // J3-F11: AND, not OR — every contracts suite must be completed. A
  // not-run contracts suite must block the sync, never silently drop
  // its tests from the stamped number (contracts-routes not-run used to
  // stamp 128 while claiming the full contracts total).
  const contractsKnown =
    isCompleted(tests, "contracts-unit") &&
    isCompleted(tests, "contracts-fuzz") &&
    isCompleted(tests, "contracts-invariant") &&
    isCompleted(tests, "contracts-account") &&
    isCompleted(tests, "contracts-fuzz-account") &&
    isCompleted(tests, "contracts-invariant-account") &&
    isCompleted(tests, "contracts-routes");
  const sdk = passed(tests, "sdk");
  const backend = passed(tests, "backend");
  const app = passed(tests, "app");
  const forkTestnet = passed(tests, "contracts-fork-testnet");
  const forkMainnet = passed(tests, "contracts-fork-mainnet");
  const forkKnown = forkTestnet !== null && forkMainnet !== null;
  // Distinct fork tests, counted ONCE (testnet run): mainnet's 7 passed
  // names are a strict subset of testnet's 10, so testnet+mainnet (17)
  // double-counts 7. Proof.tsx shows the distinct count (10).
  const forkTotal = forkKnown ? forkTestnet : null;
  // Fork DECLARED count (J3-F7): the testnet suite ran all 10 fork tests,
  // so its passed+failed+skipped is the declared total the mainnet row
  // is rendered against (7/10, not 7/7).
  const forkTestnetSuite = suite(tests, "contracts-fork-testnet");
  const forkDeclared =
    forkTestnetSuite?.status === "completed"
      ? forkTestnetSuite.passed + forkTestnetSuite.failed + forkTestnetSuite.skipped
      : null;
  const total = tests.total?.passed;

  const red =
    (tests.total?.failed ?? 0) > 0 ||
    tests.suites.some((s) => s.status === "error") ||
    tests.suites.some((s) => s.status === "completed" && s.failed > 0);
  const redDetail =
    `(total failed=${tests.total?.failed ?? 0}; ` +
    tests.suites
      .filter((s) => s.status === "error" || (s.status === "completed" && s.failed > 0))
      .map((s) => `${s.name}[${s.status},failed=${s.failed}]`)
      .join(", ") +
    ")";
  const stale = freshness(tests);
  // Self-validation (J3-F5): TESTS.json checked against itself. --check
  // never validated total/reconciliation vs the suites, so a fabricated
  // total.passed=999 sailed through. Any mismatch fails the check and
  // refuses a write.
  const selfErrors = (() => {
    const problems = [];
    const completed = tests.suites.filter((s) => s.kind !== "fork" && s.status === "completed");
    const sum = (k) => completed.reduce((n, s) => n + (s[k] ?? 0), 0);
    if (tests.total?.passed !== sum("passed")) {
      problems.push(`total.passed=${tests.total?.passed} != sum of completed non-fork suites passed=${sum("passed")}`);
    }
    if (tests.total?.failed !== sum("failed")) {
      problems.push(`total.failed=${tests.total?.failed} != sum of completed non-fork suites failed=${sum("failed")}`);
    }
    if (tests.total?.skipped !== sum("skipped")) {
      problems.push(`total.skipped=${tests.total?.skipped} != sum of completed non-fork suites skipped=${sum("skipped")}`);
    }
    const rec = tests.reconciliation;
    if (rec) {
      const declared = sum("passed") + sum("failed") + sum("skipped");
      if (rec.nonForkDeclared !== declared) {
        problems.push(`reconciliation.nonForkDeclared=${rec.nonForkDeclared} != completed non-fork declared=${declared}`);
      }
      const testnet = suite(tests, "contracts-fork-testnet");
      if (testnet?.status === "completed") {
        const testnetDeclared = testnet.passed + testnet.failed + testnet.skipped;
        if (rec.forkDeclared !== testnetDeclared) {
          problems.push(`reconciliation.forkDeclared=${rec.forkDeclared} != testnet fork declared=${testnetDeclared}`);
        }
        // Distinct fork tests counted ONCE, via the testnet run: the
        // mainnet run's 7 passed names are a strict subset of the
        // testnet run's 10, so adding mainnet.passed double-counts 7
        // (the old formula gave 512; the honest distinct count is 505).
        const inclFork =
          (tests.total?.passed ?? 0) +
          testnet.passed;
        if (rec.passedInclFork !== inclFork) {
          problems.push(`reconciliation.passedInclFork=${rec.passedInclFork} != total + testnet fork passed=${inclFork}`);
        }
      }
    }
    return problems;
  })();
  if (selfErrors.length > 0 && !CHECK) {
    console.error(
      "sync-proof: REFUSING to write — TESTS.json does not validate against itself: " +
        selfErrors.join("; ")
    );
    process.exit(1);
  }
  if (selfErrors.length > 0) {
    console.error(
      "sync-proof: FAIL — TESTS.json does not validate against itself: " +
        selfErrors.join("; ")
    );
  }
  if (red && !CHECK) {
    console.error(
      "sync-proof: REFUSING to write — TESTS.json is red " +
        redDetail +
        ". Fix the failing suites, re-run `make test-all`, then sync."
    );
    process.exit(1);
  }
  if (red) {
    console.error(
      "sync-proof: FAIL — TESTS.json is red " +
        redDetail +
        ". Drift is still checked below, but this check exits 1: a red TESTS.json must never read as green."
    );
  }
  if (!stale.fresh && !CHECK) {
    console.error(`sync-proof: REFUSING to write — TESTS.json is stale: ${stale.reason}`);
    process.exit(1);
  }
  if (!stale.fresh) {
    console.error(`sync-proof: FAIL — TESTS.json is stale: ${stale.reason}`);
  }
  const rec = tests.reconciliation;
  if (rec) {
    console.log(
      `sync-proof: reconciliation — total.passed=${total} is a NON-FORK subtotal; ` +
        `non-fork declared=${rec.nonForkDeclared}, fork declared=${rec.forkDeclared ?? "n/a"}, ` +
        `passed incl. fork=${rec.passedInclFork}, distinct declared=${rec.forkDeclared === null ? "n/a" : rec.nonForkDeclared + rec.forkDeclared + 11} (C12: +11 invariant properties)`
    );
  }
  if (typeof total !== "number" || !contractsKnown || sdk === null || backend === null || app === null) {
    console.error(
      "sync-proof: TESTS.json is missing a completed non-fork suite " +
        `(contracts=${contractsKnown} sdk=${sdk} backend=${backend} app=${app}); ` +
        "run `make test-all` first"
    );
    process.exit(1);
  }

  // Each edit: {file, pattern, replacement, label, skip?}.
  // `pattern` must match exactly once; a miss is a hard error, never a
  // silent skip — a README/Proof rewrite that silently stops matching is
  // how numbers drift again.
  const edits = [];
  const add = (file, pattern, replacement, label, skip = false) =>
    edits.push({ file, pattern, replacement, label, skip });

  // README.md — badge (line 13) and "N passing (non-fork subtotal)"
  // (line 125). The pattern matches BOTH the old "N in total" label and
  // the new one, so the first sync after this change still rewrites it.
  // The label is the J2-F5 fix: total.passed is a non-fork subtotal, and
  // "N in total" let it be read as the whole table's total.
  add("README.md", /tests-\d+%20passing/, `tests-${total}%20passing`, `badge -> ${total} passing`);
  add(
    "README.md",
    /\d+ in total \(E2E not counted\)|\d+ passing \(non-fork subtotal; E2E not counted\)/,
    `${total} passing (non-fork subtotal; E2E not counted)`,
    `"N passing (non-fork subtotal)" -> ${total}`
  );
  // README.md — Tests table bold numbers (row-anchored so only the number moves).
  add(
    "README.md",
    /(\| Contracts: unit, branch, fuzz, invariant, reentrancy \|[^\n]*?)\*\*\d+ passing\*\*/,
    `$1**${contracts} passing**`,
    `contracts row -> ${contracts} passing`
  );
  add(
    "README.md",
    /(\| SDK \(EIP-712 digests equal Solidity\) \|[^\n]*?)\*\*\d+\/\d+\*\*/,
    `$1**${sdk}/${sdk}**`,
    `sdk row -> ${sdk}/${sdk}`
  );
  // Backend row renders passed/DECLARED (5417bb0): an earlier run
  // executed only 74 of the 80 declared backend tests
  // (`test/config.test.ts`, 6 tests, was not in it). The current
  // TESTS.json run includes `config.test.ts` — 80 executed, 80 passed.
  // The script syncs only the passed number from TESTS.json; the
  // declared number is hand prose counted by word-boundary `it(` (see
  // the row's own parenthetical), like the parenthetical breakdowns
  // this script deliberately does not touch.
  add(
    "README.md",
    /(\| Backend \(x402 API, indexer\) \|[^\n]*?)\*\*(\d+) passed of (\d+) declared\*\*/,
    `$1**${backend} passed of $3 declared**`,
    `backend row -> ${backend} passed of <declared> declared`
  );
  add(
    "README.md",
    /(\| App unit \|[^\n]*?)\*\*\d+\/\d+\*\*/,
    `$1**${app}/${app}**`,
    `app row -> ${app}/${app}`
  );
  // Fork rows render passed/DECLARED (J3-F7): testnet ran all 10, so
  // testnet reads 10/10; mainnet passed 7 of 10 declared (3 skipped),
  // so mainnet reads 7/10. The "(3 skipped — …)" parenthetical is hand
  // prose in README/JUDGES; only the bold N/M moves here.
  add(
    "README.md",
    /(\| Fork, real Mezo \*\*testnet\*\* \|[^\n]*?)\*\*\d+\/\d+\*\*/,
    `$1**${forkTestnet}/${forkDeclared}**`,
    `fork testnet row -> ${forkTestnet}/${forkDeclared}`,
    !forkKnown
  );
  add(
    "README.md",
    /(\| Fork, real Mezo \*\*mainnet\*\* \|[^\n]*?)\*\*\d+\/\d+\*\*/,
    `$1**${forkMainnet}/${forkDeclared}**`,
    `fork mainnet row -> ${forkMainnet}/${forkDeclared}`,
    !forkKnown
  );

  // app/src/landing/Proof.tsx — COUNTS rows (lines 6-10) + count date.
  const proofFile = "app/src/landing/Proof.tsx";
  add(
    proofFile,
    /\['\d+', 'Contract tests: unit, fuzz, invariant'\]/,
    `['${contracts}', 'Contract tests: unit, fuzz, invariant']`,
    `Proof contracts -> ${contracts}`
  );
  add(
    proofFile,
    /\['\d+', 'Fork tests on live Mezo testnet \+ mainnet'\]/,
    `['${forkTotal}', 'Fork tests on live Mezo testnet + mainnet']`,
    `Proof fork -> ${forkTotal}`,
    !forkKnown
  );
  add(
    proofFile,
    /\['\d+', 'Backend tests \(API, x402, bot\)'\]/,
    `['${backend}', 'Backend tests (API, x402, bot)']`,
    `Proof backend -> ${backend}`
  );
  add(
    proofFile,
    /\['\d+', 'SDK \+ app unit tests'\]/,
    `['${sdk + app}', 'SDK + app unit tests']`,
    `Proof sdk+app -> ${sdk + app}`
  );
  const genDate = String(tests.generatedAt ?? "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(genDate)) {
    add(
      proofFile,
      /\/\/ Counted by running each suite on \d{4}-\d{2}-\d{2};/,
      `// Counted by running each suite on ${genDate};`,
      `Proof count date -> ${genDate}`
    );
  }

  // judges/JUDGES.md — unit/fuzz/invariant row, fork rows, sdk row.
  add(
    "judges/JUDGES.md",
    /(\| Unit, fuzz, invariant tests \(mocks\) \|[^\n]*?\| )\d+ pass/,
    `$1${contracts} pass`,
    `JUDGES unit row -> ${contracts} pass`
  );
  add(
    "judges/JUDGES.md",
    /(\| Fork tests against the real Mezo testnet \|[^\n]*?\| )\d+\/\d+ pass/,
    `$1${forkTestnet}/${forkDeclared} pass`,
    `JUDGES fork testnet -> ${forkTestnet}/${forkDeclared} pass`,
    !forkKnown
  );
  add(
    "judges/JUDGES.md",
    /(\| Fork tests against the real Mezo mainnet \|[^\n]*?\| )\d+\/\d+ pass/,
    `$1${forkMainnet}/${forkDeclared} pass`,
    `JUDGES fork mainnet -> ${forkMainnet}/${forkDeclared} pass`,
    !forkKnown
  );
  add(
    "judges/JUDGES.md",
    /(\| SDK tests \(EIP-712 parity with Solidity, nonce coordination\) \|[^\n]*?\| )\d+ pass/,
    `$1${sdk} pass`,
    `JUDGES sdk row -> ${sdk} pass`
  );

  // Apply per file.
  const byFile = new Map();
  for (const e of edits) {
    if (!byFile.has(e.file)) byFile.set(e.file, []);
    byFile.get(e.file).push(e);
  }
  let changed = 0;
  let skipped = 0;
  for (const [file, fileEdits] of byFile) {
    const path = join(ROOT, file);
    let text;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      console.error(`sync-proof: cannot read ${file}`);
      process.exit(1);
    }
    let out = text;
    for (const e of fileEdits) {
      if (e.skip) {
        console.log(`sync-proof: SKIP ${file}: ${e.label} (fork suites not run — set FORK=1 to record them)`);
        skipped++;
        continue;
      }
      const matches = out.match(e.pattern);
      if (!matches) {
        console.error(`sync-proof: PATTERN NOT FOUND in ${file}: ${e.label} — the file changed shape; update this script, do not hand-edit the number`);
        process.exit(1);
      }
      const next = out.replace(e.pattern, e.replacement);
      if (next !== out) {
        changed++;
        console.log(`sync-proof: ${CHECK ? "DRIFT" : "sync"} ${file}: ${e.label}`);
      }
      out = next;
    }
    if (!CHECK && out !== text) writeFileSync(path, out);
  }

  if (skipped > 0) {
    console.log(
      `sync-proof: ${skipped} fork edit(s) skipped — fork suites are "not-run" in TESTS.json. ` +
        "Run FORK=1 make test-all, then sync again to stamp the fork rows."
    );
  }
  console.log(
    "sync-proof: README table breakdowns in parentheses (e.g. \"Governor 21 + …\") " +
      "are hand-written prose and are NOT rewritten by this script — their owning tasks must refresh them."
  );
  if (CHECK) {
    // A red, stale, or self-inconsistent TESTS.json fails the check even
    // when the numbers match: the old behaviour (exit 0 on matching
    // numbers) let red counts ship as a passing drift gate.
    if (red || !stale.fresh || selfErrors.length > 0) {
      const why = [
        red ? "red" : null,
        !stale.fresh ? "stale" : null,
        selfErrors.length > 0 ? "self-inconsistent" : null,
      ]
        .filter(Boolean)
        .join(" and ");
      console.error(
        `sync-proof: CHECK FAILED — TESTS.json is ${why}; fix it and re-run \`make test-all\``
      );
      process.exit(1);
    }
    // J3-F6: fork suites "not-run" while README/JUDGES still claim fork
    // numbers (10/10, 7/7) is an unverified claim — fail the check.
    // (Write mode skips the fork edits and warns instead; the check is
    // the gate that stops the claim landing.)
    if (!forkKnown) {
      const claims = [];
      for (const [file, pattern] of [
        ["README.md", /\| Fork, real Mezo \*\*(?:testnet|mainnet)\*\* \|[^\n]*?\*\*\d+\/\d+\*\*/],
        ["judges/JUDGES.md", /\| Fork tests against the real Mezo (?:testnet|mainnet) \|[^\n]*?\d+\/\d+ pass/],
      ]) {
        let text = "";
        try {
          text = readFileSync(join(ROOT, file), "utf8");
        } catch {
          continue;
        }
        const m = text.match(pattern);
        if (m) claims.push(`${file}: "${m[0].slice(0, 80)}"`);
      }
      if (claims.length > 0) {
        console.error(
          "sync-proof: CHECK FAILED — fork suites are \"not-run\" in TESTS.json but README/JUDGES still claim fork numbers: " +
            claims.join("; ") +
            ". Run FORK=1 make test-all, then sync."
        );
        process.exit(1);
      }
    }
    if (changed > 0) {
      console.error(`sync-proof: CHECK FAILED — ${changed} number(s) drift from TESTS.json; run \`node scripts/sync-proof.mjs\` to regenerate`);
      process.exit(1);
    }
    console.log("sync-proof: CHECK OK — README / Proof.tsx / JUDGES.md numbers match TESTS.json");
    process.exit(0);
  }
  console.log(
    changed > 0
      ? `sync-proof: done — ${changed} number(s) updated from TESTS.json (generatedAt ${tests.generatedAt}, commit ${tests.commit})`
      : "sync-proof: done — numbers already matched TESTS.json, nothing changed"
  );
}

main();
