// summarize.mjs — merge out/*.json (written by scripts/count-tests.sh)
// into TESTS.json at the repo root.
//
// Usage:
//   node scripts/summarize.mjs [out-dir]     # default: ./out
//   node scripts/summarize.mjs out/*.json     # explicit files also work
//
// Output shape (plan §7.1):
//   { generatedAt, commit, suites: [{name, kind, passed, failed, skipped,
//     status, note?}], total: {passed, failed, skipped},
//     reconciliation: {nonForkDeclared, forkDeclared, passedInclFork, note},
//     forkNote: "fork suites listed separately, never added twice" }
//
// `total` is a NON-FORK subtotal (see the reconciliation note below): it
// sums only completed non-fork suites. Never label it "N in total" — the
// table sums to more once the fork rows are added (plan C12: 198 distinct
// declared on the pre-merge tree vs 179 passed non-fork).
//
// Honesty rules (repo audit §G — distinct count 198, not 203):
// - `total` sums ONLY non-fork suites. Every kind:"fork" suite (the
//   offline skip line, the testnet fork pass, the mainnet fork pass) is
//   listed separately and excluded from the total, so the same 10 fork
//   tests are never counted twice (or three times).
// - Forge JSON is grouped by the test's own kind: Unit -> "unit",
//   Fuzz -> "fuzz", Invariant -> "invariant". A forge file therefore
//   yields one suite per kind present (e.g. forge-unit.json yields both
//   "contracts-unit" and "contracts-fuzz"). Fork files are grouped by
//   file, not by test kind: every test in them is kind "fork".
// - Forge counts each invariant suite as ONE test (2 suites = 2 in the
//   forge summary, although the files declare 4 invariant properties).
//   That is what is reported here — the real executed count, not the
//   declared-property count.
// - Vitest JSON is counted from testResults[].assertionResults FIRST
//   (the per-test list is authoritative); the top-level numPassedTests /
//   numFailedTests / numPendingTests are only a fallback when a reporter
//   omits testResults. (An earlier header comment had this backwards:
//   it described the top-level numbers as primary and assertionResults
//   as the fallback. The code always counted assertionResults first.)
// - A missing/unparseable output is reported as a suite with
//   status "error" and 0 counts — never silently dropped, never
//   invented. A package that does not exist yet (mcp, keeper) is
//   reported as status "missing". A fork pass that was not run
//   (FORK=1 not set) is reported as status "not-run".
// - Exit code: 0 iff every completed suite has 0 failures and no suite
//   is in "error" status; 1 otherwise. ("missing"/"not-run" do not fail
//   the run — they are expected states for work not built/run yet.)
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FORK_NOTE = "fork suites listed separately, never added twice";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Expected outputs, in display order. `file` is the out/*.json name;
// `name`/`kind` are the TESTS.json suite identity. Fork files are only
// produced when FORK=1; mcp/keeper files are "missing" markers until
// those packages exist.
const EXPECTED = [
  { file: "forge-unit.json", name: "contracts-unit", kind: "unit" },
  { file: "forge-unit.json", name: "contracts-fuzz", kind: "fuzz" },
  { file: "forge-invariant.json", name: "contracts-invariant", kind: "invariant" },
  // Added after the gov-chain merge (main 019fece): 1.1/1.5/0.5 landed
  // test/account/* (Factory, Radar) and test/routes/* (RouterSlippage).
  // They are unit tests and must be counted — the old three-pass split
  // silently omitted them on the merged tree.
  { file: "forge-account.json", name: "contracts-account", kind: "unit" },
  { file: "forge-routes.json", name: "contracts-routes", kind: "unit" },
  { file: "forge-fork-offline.json", name: "contracts-fork-offline", kind: "fork" },
  { file: "forge-fork-testnet.json", name: "contracts-fork-testnet", kind: "fork" },
  { file: "forge-fork-mainnet.json", name: "contracts-fork-mainnet", kind: "fork" },
  { file: "sdk.json", name: "sdk", kind: "unit" },
  { file: "backend.json", name: "backend", kind: "unit" },
  { file: "app.json", name: "app", kind: "unit" },
  { file: "mcp.json", name: "mcp", kind: "unit" },
  { file: "keeper.json", name: "keeper", kind: "unit" },
];

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

// Forge --json: { "test/file.t.sol:Contract": { test_results: {
//   "test_x()": { status: "Success"|"Failure"|"Skipped", kind: {"Unit"|"Fuzz"|"Invariant": {...}} } } } }
//
// Forge JSON carries NO declared total, so the totals guard below is
// entry-level: every test_results entry must have a known status, and a
// file with zero entries for an expected kind is an error (a suite that
// ran zero tests of its kind is a broken run, not a pass). The vitest
// guard cross-checks sum(assertionResults) against numTotalTests.
function countForge(data, wantKind) {
  let passed = 0, failed = 0, skipped = 0, entries = 0, unknown = 0;
  for (const contract of Object.values(data)) {
    const results = contract?.test_results ?? {};
    for (const t of Object.values(results)) {
      const kindKey = Object.keys(t?.kind ?? {})[0] ?? "Unit";
      // Fork files: kind is decided by the file, not the test.
      if (wantKind !== "fork" && kindKey.toLowerCase() !== wantKind) continue;
      entries++;
      if (t.status === "Success") passed++;
      else if (t.status === "Failure") failed++;
      else if (t.status === "Skipped") skipped++;
      else unknown++;
    }
  }
  const mismatch =
    unknown > 0
      ? `${unknown} test(s) with unknown status (expected Success/Failure/Skipped)`
      : entries === 0
        ? `no test_results entries for kind "${wantKind}" in forge JSON`
        : null;
  return { passed, failed, skipped, mismatch };
}

// Vitest --reporter=json: { numTotalTests, numPassedTests,
// numFailedTests, numPendingTests, testResults: [...] }
//
// Count from testResults[].assertionResults, NOT from the top-level
// num*Tests: vitest 4's numPendingTests undercounts skipped tests
// (backend, committed run 2026-11-15, out/backend.json: numPendingTests=1
// while the per-test results list 5 pending assertions, and 65 passed +
// 2 failed + 5 pending = 72 = numTotalTests). The per-test list is
// authoritative; the top-level numbers are only a fallback when a
// reporter omits testResults.
//
// Completeness guard (J3-F3): when the report carries numTotalTests,
// sum(assertionResults) MUST equal it. Vitest prints "Some tests are
// still running when generating the JSON report" (out/backend.stderr:1
// in the committed run) exactly when the report is truncated — a
// truncated report must never be counted as a clean pass. On mismatch
// the suite is marked "error" (see main()).
function countVitest(data) {
  const files = data.testResults ?? [];
  let sawAny = false;
  let passed = 0, failed = 0, skipped = 0;
  for (const file of files) {
    for (const a of file.assertionResults ?? []) {
      sawAny = true;
      if (a.status === "passed") passed++;
      else if (a.status === "failed") failed++;
      else skipped++; // "pending" | "skipped" | "todo"
    }
  }
  if (sawAny) {
    const sum = passed + failed + skipped;
    const mismatch =
      typeof data.numTotalTests === "number" && sum !== data.numTotalTests
        ? `assertionResults sum ${sum} != numTotalTests ${data.numTotalTests} (report incomplete — vitest "Some tests are still running"?)`
        : null;
    return { passed, failed, skipped, mismatch };
  }
  if (typeof data.numTotalTests === "number" && data.numTotalTests > 0) {
    return {
      passed: data.numPassedTests ?? 0,
      failed: data.numFailedTests ?? 0,
      skipped: data.numPendingTests ?? 0,
      mismatch: `testResults has no per-test list but numTotalTests=${data.numTotalTests} — nothing to verify the totals against`,
    };
  }
  return {
    passed: data.numPassedTests ?? 0,
    failed: data.numFailedTests ?? 0,
    skipped: data.numPendingTests ?? 0,
    mismatch: null,
  };
}

function gitCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function main() {
  const args = process.argv.slice(2);
  let outDir = join(ROOT, "out");
  let files = null;
  if (args.length === 1 && existsSync(args[0]) && !args[0].endsWith(".json")) {
    outDir = resolve(args[0]);
  } else if (args.length > 0) {
    files = args.map((a) => resolve(a));
    outDir = dirname(files[0]);
  }
  if (!files) {
    files = readdirSync(outDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => join(outDir, f));
  }
  const byFile = new Map(files.map((f) => [basename(f), f]));

  const suites = [];
  for (const exp of EXPECTED) {
    const path = byFile.get(exp.file);
    if (!path || !existsSync(path)) {
      // No output at all for this expected suite.
      if (exp.kind === "fork" && exp.file !== "forge-fork-offline.json") {
        suites.push({ name: exp.name, kind: exp.kind, passed: 0, failed: 0, skipped: 0, status: "not-run", note: "fork pass not run (set FORK=1 to run it over RPC)" });
      } else if (exp.name === "mcp" || exp.name === "keeper") {
        suites.push({ name: exp.name, kind: exp.kind, passed: 0, failed: 0, skipped: 0, status: "missing", note: `${exp.name} package does not exist yet` });
      } else {
        suites.push({ name: exp.name, kind: exp.kind, passed: 0, failed: 0, skipped: 0, status: "error", note: `no output file ${exp.file} (runner crashed or never ran)` });
      }
      continue;
    }
    const data = readJson(path);
    if (data === null) {
      suites.push({ name: exp.name, kind: exp.kind, passed: 0, failed: 0, skipped: 0, status: "error", note: `${exp.file} is not parseable JSON` });
      continue;
    }
    if (typeof data.status === "string" && data.status !== "completed") {
      // Marker written by count-tests.sh: {"status":"missing"|"error","note":"..."}
      suites.push({ name: exp.name, kind: exp.kind, passed: 0, failed: 0, skipped: 0, status: data.status, note: data.note ?? "" });
      continue;
    }
    const counts = exp.file.startsWith("forge-") ? countForge(data, exp.kind) : countVitest(data);
    // Totals guard (J3-F3): a report whose own totals do not reconcile is
    // an error, never a pass — even if every counted test passed. The
    // counted numbers are kept in the suite so the failure is diagnosable,
    // but the suite leaves "completed", so it is excluded from `total`
    // and the run exits 1.
    if (counts.mismatch) {
      suites.push({ name: exp.name, kind: exp.kind, passed: counts.passed, failed: counts.failed, skipped: counts.skipped, status: "error", note: counts.mismatch });
      continue;
    }
    const { mismatch: _mismatch, ...cleanCounts } = counts;
    const suite = { name: exp.name, kind: exp.kind, ...cleanCounts, status: "completed" };
    if (exp.kind === "fork") {
      suite.note = "excluded from total to avoid double-counting";
    }
    if (exp.file === "forge-fork-offline.json") {
      // Forge reports a skipped fork contract as a single skipped setUp(),
      // so this line reads skipped=2 (one per fork contract) although the
      // files declare 10 fork tests (7 + 3). The real fork runs list them
      // individually; the declared count is in the audit, not invented here.
      suite.note += "; forge reports skipped fork contracts as 1 skipped setUp() each (10 fork tests declared)";
    }
    suites.push(suite);
  }

  const total = { passed: 0, failed: 0, skipped: 0 };
  for (const s of suites) {
    if (s.kind === "fork" || s.status !== "completed") continue;
    total.passed += s.passed;
    total.failed += s.failed;
    total.skipped += s.skipped;
  }

  // Reconciliation (J2-F5, plan C12): `total` is a NON-FORK subtotal, so
  // it must never be read as "N in total". The distinct declared count
  // is nonForkDeclared + forkDeclared + 2: forge executes each invariant
  // suite as ONE test although the files declare 4 invariant properties
  // (3 in Invariant.t.sol + 1 in RouterInvariant.t.sol), and the fork
  // suites (offline/testnet/mainnet) are the SAME 10 tests listed three
  // times, counted once here via the testnet run. Example on the
  // pre-merge tree: 186 non-fork declared + 10 fork + 2 invariant
  // properties = 198 distinct declared (C12) vs 179 passed non-fork.
  const nonForkDeclared = suites
    .filter((s) => s.kind !== "fork" && s.status === "completed")
    .reduce((n, s) => n + s.passed + s.failed + s.skipped, 0);
  const forkTestnetSuite = suites.find((s) => s.name === "contracts-fork-testnet");
  const forkMainnetSuite = suites.find((s) => s.name === "contracts-fork-mainnet");
  const forkDeclared =
    forkTestnetSuite?.status === "completed"
      ? forkTestnetSuite.passed + forkTestnetSuite.failed + forkTestnetSuite.skipped
      : null;
  const passedInclFork =
    total.passed +
    (forkTestnetSuite?.status === "completed" ? forkTestnetSuite.passed : 0) +
    (forkMainnetSuite?.status === "completed" ? forkMainnetSuite.passed : 0);
  const reconciliation = {
    nonForkDeclared,
    forkDeclared,
    passedInclFork,
    note: "total.passed is a NON-FORK subtotal (fork suites listed separately, never added twice). Distinct declared tests = nonForkDeclared + forkDeclared + 2 (forge counts each invariant suite as 1 executed test; the files declare 4 invariant properties). Do not read total.passed as 'N in total'.",
  };

  const result = {
    generatedAt: new Date().toISOString(),
    commit: gitCommit(),
    suites,
    total,
    reconciliation,
    forkNote: FORK_NOTE,
  };
  writeFileSync(join(ROOT, "TESTS.json"), JSON.stringify(result, null, 2) + "\n");

  const failed = suites.some((s) => s.status === "completed" && s.failed > 0);
  const errored = suites.some((s) => s.status === "error");
  for (const s of suites) {
    console.log(`${s.name} (${s.kind}): passed=${s.passed} failed=${s.failed} skipped=${s.skipped} [${s.status}]${s.note ? ` — ${s.note}` : ""}`);
  }
  console.log(`total (non-fork subtotal, NOT "in total"): passed=${total.passed} failed=${total.failed} skipped=${total.skipped}`);
  console.log(`reconciliation: non-fork declared=${nonForkDeclared}, fork declared=${forkDeclared ?? "n/a"}, passed incl. fork=${passedInclFork}, distinct declared=${forkDeclared === null ? "n/a" : nonForkDeclared + forkDeclared + 2} (C12: +2 invariant properties)`);
  process.exit(failed || errored ? 1 : 0);
}

main();
