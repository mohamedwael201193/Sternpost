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
//     is claimed about a run that did not happen. Sync leaves them alone
//     and warns; --check skips them instead of failing.
//
// Honesty guard: sync (write mode) REFUSES to run when TESTS.json has any
// failed test or any suite in "error" status, OR when TESTS.json is stale
// (sources under contracts/backend/sdk/app/mcp/keeper changed since the
// commit TESTS.json was generated from, or uncommitted changes there).
// Stamping a green "N passing" badge over red or stale counts would be a
// lie; fix the failing suites first, re-run `make test-all`, then sync.
// --check mode FAILS (exit 1) on a red or stale TESTS.json, after still
// reporting drift, so CI can never go green on red/stale numbers: the old
// behaviour (warn about red, exit 0 when numbers matched) let a red
// TESTS.json ship as a passing drift check, and the old workflow path
// filter blinded it to gov-chain/backend merges entirely.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = process.argv.includes("--check");
// Source paths whose changes stale the counts: the code under test. (The
// 0.8 scripts themselves are versioned with TESTS.json; a script change
// is reviewed together with the numbers it produces.)
const SOURCE_PATHS = ["contracts", "backend", "sdk", "app", "mcp", "keeper"];
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
function freshness(tests) {
  const commit = tests.commit;
  if (!commit || commit === "unknown") {
    return { fresh: false, reason: `TESTS.json commit is "${commit ?? "missing"}" — re-run \`make test-all\`` };
  }
  try {
    const head = execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
    const changed = notGenerated(
      execSync(`git diff --name-only ${commit} ${head} -- ${SOURCE_PATHS.join(" ")}`, {
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
      execSync(`git status --porcelain -- ${SOURCE_PATHS.join(" ")}`, {
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
    (passed(tests, "contracts-routes") ?? 0);
  const contractsKnown =
    isCompleted(tests, "contracts-unit") ||
    isCompleted(tests, "contracts-fuzz") ||
    isCompleted(tests, "contracts-invariant") ||
    isCompleted(tests, "contracts-account") ||
    isCompleted(tests, "contracts-routes");
  const sdk = passed(tests, "sdk");
  const backend = passed(tests, "backend");
  const app = passed(tests, "app");
  const forkTestnet = passed(tests, "contracts-fork-testnet");
  const forkMainnet = passed(tests, "contracts-fork-mainnet");
  const forkKnown = forkTestnet !== null && forkMainnet !== null;
  const forkTotal = forkKnown ? forkTestnet + forkMainnet : null;
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
        `passed incl. fork=${rec.passedInclFork}, distinct declared=${rec.forkDeclared === null ? "n/a" : rec.nonForkDeclared + rec.forkDeclared + 2} (C12: +2 invariant properties)`
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
  add(
    "README.md",
    /(\| Backend \(x402 API, indexer\) \|[^\n]*?)\*\*\d+\/\d+\*\*/,
    `$1**${backend}/${backend}**`,
    `backend row -> ${backend}/${backend}`
  );
  add(
    "README.md",
    /(\| App unit \|[^\n]*?)\*\*\d+\/\d+\*\*/,
    `$1**${app}/${app}**`,
    `app row -> ${app}/${app}`
  );
  add(
    "README.md",
    /(\| Fork, real Mezo \*\*testnet\*\* \|[^\n]*?)\*\*\d+\/\d+\*\*/,
    `$1**${forkTestnet}/${forkTestnet}**`,
    `fork testnet row -> ${forkTestnet}/${forkTestnet}`,
    !forkKnown
  );
  add(
    "README.md",
    /(\| Fork, real Mezo \*\*mainnet\*\* \|[^\n]*?)\*\*\d+\/\d+\*\*/,
    `$1**${forkMainnet}/${forkMainnet}**`,
    `fork mainnet row -> ${forkMainnet}/${forkMainnet}`,
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
    `$1${forkTestnet}/${forkTestnet} pass`,
    `JUDGES fork testnet -> ${forkTestnet}/${forkTestnet} pass`,
    !forkKnown
  );
  add(
    "judges/JUDGES.md",
    /(\| Fork tests against the real Mezo mainnet \|[^\n]*?\| )\d+\/\d+ pass/,
    `$1${forkMainnet}/${forkMainnet} pass`,
    `JUDGES fork mainnet -> ${forkMainnet}/${forkMainnet} pass`,
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
    // A red or stale TESTS.json fails the check even when the numbers
    // match: the old behaviour (exit 0 on matching numbers) let red
    // counts ship as a passing drift gate.
    if (red || !stale.fresh) {
      console.error(
        `sync-proof: CHECK FAILED — TESTS.json is ${red ? "red" : ""}${red && !stale.fresh ? " and " : ""}${!stale.fresh ? "stale" : ""}; fix it and re-run \`make test-all\``
      );
      process.exit(1);
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
