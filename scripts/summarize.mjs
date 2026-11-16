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
// - Forge counts each invariant suite as ONE test (3 suites = 3 in the
//   forge summary, although the files declare 14 invariant properties:
//   3 in Invariant.t.sol + 1 in RouterInvariant.t.sol + 10 in
//   account/Invariant.t.sol).
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
//
// Guards (J3 9166e9f2, 0.8 hardening 2026-11-15) — every one of these
// fails the run (suite status "error", exit 1) instead of silently
// passing with wrong counts:
// - F1: every forge entry in a file must be counted by exactly one
//   EXPECTED suite for that file. An entry whose kind has no EXPECTED
//   suite (e.g. a fuzz test in forge-account.json before the J1 fix)
//   is an error, never a silent skip.
// - F2 (stronger): counted tests are cross-checked against the
//   SOURCE-declared test functions (`function test…` in the .t.sol
//   files under each forge pass's match-path). The executed test-name
//   set must equal the declared set, except that whole contracts
//   skipped at setUp (one skipped setUp() entry per skipped contract,
//   e.g. RouterForkTest on the mainnet fork) stand for all of that
//   contract's declared tests. A truncated JSON or a deleted
//   contract's entries fail here even though the JSON's own totals
//   still reconcile — the file's "total" is itself the lie.
//   Invariant files are checked differently: forge reports one entry
//   per invariant contract (3 entries for 14 declared properties
//   across the tree), so
//   the check is entry-count == #contracts declaring invariant_
//   functions, and every entry name must be a declared invariant_ name.
//   A MIXED dir (test/account/*: unit + fuzz + one invariant contract)
//   partitions its entries and checks each kind by its own rule — an
//   invariant entry must never be diffed against the declared test names.
// - F3: a vitest report with no verifiable evidence (no per-test list
//   AND no numTotalTests, e.g. `{}`) is an error, not completed 0/0/0.
// - F4: an out/forge-*.json file EXPECTED does not cover, or a
//   contracts/test/**/*.t.sol file outside the mapped match-path dirs,
//   is an error — an unlisted suite (passing or failing) must never be
//   silently ignored.
// - Inputs hash: TESTS.json records `inputs.forgeStdHash`, a sha256
//   over contracts/lib/forge-std/src (gitignored, so git freshness
//   cannot see it). sync-proof.mjs re-checks it when the directory
//   is present; when absent (fresh checkout, CI drift job) the check
//   is skipped, not failed.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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
  // test/account/* is NOT all unit: Factory.t.sol declares the fuzz test
  // testFuzz_predictMatchesCreated, so forge-account.json yields BOTH a
  // unit suite and a fuzz suite (like forge-unit.json). An earlier header
  // comment said "They are unit tests" — that false premise is what made
  // the fuzz test silently uncounted (J1 56055b0e): countForge skips any
  // entry whose kind != the wanted kind, and there was no
  // (forge-account.json, fuzz) entry in EXPECTED.
  { file: "forge-account.json", name: "contracts-account", kind: "unit" },
  { file: "forge-account.json", name: "contracts-fuzz-account", kind: "fuzz" },
  // Added after 1.7-1.8 (main 8502a26): test/account/* gained an
  // invariant suite (Invariant.t.sol, TroveAccountInvariantTest, 10
  // properties, 1 forge entry), so forge-account.json yields a THIRD
  // kind. Same false-premise trap as the J1 fuzz entry above: without
  // this, the invariant entry is "unaccounted" and the run errors.
  { file: "forge-account.json", name: "contracts-invariant-account", kind: "invariant" },
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

// Forge source map (J3-F2): each forge output file -> the contracts/test
// directory its --match-path pass covers (see scripts/count-tests.sh).
// `mode` selects the source cross-check: "unit" and "fork" compare the
// executed test-name set against the declared `function test…` set;
// "invariant" compares entry count against #contracts declaring
// invariant_ functions (forge reports one entry per invariant contract).
// "mixed" (test/account/* only) partitions the entries by kind and
// checks the invariant ones by the invariant rule and the rest by the
// unit rule — the dir holds unit + fuzz tests AND one invariant contract.
// Fork files share the test/fork source dir; their whole-contract
// setUp-skip rule is what makes the mainnet 7/10 honest instead of a
// miscount (see checkForgeAgainstSource).
const FORGE_SOURCE = {
  "forge-unit.json": { dir: "contracts/test/unit", mode: "unit" },
  "forge-account.json": { dir: "contracts/test/account", mode: "mixed" },
  "forge-routes.json": { dir: "contracts/test/routes", mode: "unit" },
  "forge-invariant.json": { dir: "contracts/test/invariant", mode: "invariant" },
  "forge-fork-offline.json": { dir: "contracts/test/fork", mode: "fork" },
  "forge-fork-testnet.json": { dir: "contracts/test/fork", mode: "fork" },
  "forge-fork-mainnet.json": { dir: "contracts/test/fork", mode: "fork" },
};

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

// All test_results entries in a forge --json, flattened across its
// top-level keys (forge flattens a whole --match-path pass under one
// synthetic key, e.g. "test/unit/Unit.t.sol:UnitTest", so the keys
// carry no per-contract information — only the entry names do).
// Returns [{name, status, kindKey}] with name bare (no "()").
function collectForgeEntries(data) {
  const entries = [];
  for (const contract of Object.values(data)) {
    const results = contract?.test_results ?? {};
    for (const [name, t] of Object.entries(results)) {
      entries.push({
        // Fuzz entries carry their parameter list
        // ("testFuzz_x(address,bytes32)"); unit entries carry "()".
        // Strip either, so names compare against the declared
        // `function test…` names from source.
        name: name.replace(/\(.*\)$/, ""),
        status: t?.status ?? "Unknown",
        kindKey: Object.keys(t?.kind ?? {})[0] ?? "Unit",
      });
    }
  }
  return entries;
}

// Parse the .t.sol files in a test directory (comments stripped) into
// per-contract declared test/invariant function names. Only contracts
// that declare at least one test or invariant function are returned;
// helper contracts (mocks, bases) declare none and are ignored.
function parseSourceTests(dir) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return null;
  const byContract = new Map(); // contract -> { tests: Set, invariants: Set }
  for (const f of readdirSync(abs).filter((x) => x.endsWith(".t.sol")).sort()) {
    const src = readFileSync(join(abs, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, "");
    let current = null;
    const re = /\bcontract\s+(\w+)\b|\bfunction\s+(test\w*|invariant_\w*)\s*\(/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      if (m[1]) {
        current = m[1];
        if (!byContract.has(current)) byContract.set(current, { tests: new Set(), invariants: new Set() });
      } else if (current && m[2]) {
        const set = m[2].startsWith("invariant_")
          ? byContract.get(current).invariants
          : byContract.get(current).tests;
        set.add(m[2]);
      }
    }
  }
  for (const [c, sets] of [...byContract]) {
    if (sets.tests.size === 0 && sets.invariants.size === 0) byContract.delete(c);
  }
  return byContract;
}

// Source cross-check (J3-F2, stronger): the executed test names in a
// forge file must match the source-declared ones. Returns null when the
// file reconciles, else an error string.
//   - unit/fork: executed non-setUp names must equal the declared test
//     names, except whole contracts skipped at setUp: a Skipped
//     setUp() entry stands for ALL of one contract's declared tests
//     (mainnet fork: RouterForkTest's 3 tests collapse into one
//     skipped setUp(); offline fork: both contracts collapse the same
//     way). Missing tests must be exactly coverable by whole skipped
//     contracts, and the number of skipped setUp() entries must equal
//     the number of skipped contracts. A truncated file or a deleted
//     contract leaves declared names unexecuted with no setUp to
//     justify them -> error.
//   - invariant: entry count must equal the number of contracts
//     declaring invariant_ functions, and every entry name must be a
//     declared invariant_ name (forge reports one entry per invariant
//     contract although the files declare 14 properties across the tree).
//   - mixed: the invariant entries are checked by the invariant rule
//     and the rest by the unit rule (see checkForgeAgainstSource).
function checkInvariantNames(byContract, names, file) {
  const invContracts = [...byContract.values()].filter((s) => s.invariants.size > 0);
  const declaredInv = new Set(invContracts.flatMap((s) => [...s.invariants]));
  const bad = names.filter((n) => !declaredInv.has(n));
  if (names.length !== invContracts.length) {
    return `source cross-check: ${file} reports ${names.length} invariant entries but ${invContracts.length} contracts declare invariant_ functions (${[...declaredInv].join(", ")})`;
  }
  if (bad.length > 0) {
    return `source cross-check: ${file} reports undeclared invariant entries: ${bad.join(", ")}`;
  }
  return null;
}

function checkUnitNames(byContract, entries, file, spec) {
  const executed = entries.filter((e) => e.name !== "setUp").map((e) => e.name);
  const skippedSetUps = entries.filter((e) => e.name === "setUp" && e.status === "Skipped").length;
  const declaredByContract = [...byContract.entries()]
    .filter(([, s]) => s.tests.size > 0)
    .map(([c, s]) => [c, [...s.tests]]);
  // Multiset comparison (sorted lists): two overloads sharing a bare
  // name must still both be present — a bare-name SET would collapse
  // them and miss a deletion.
  const countMap = (list) => {
    const m = new Map();
    for (const n of list) m.set(n, (m.get(n) ?? 0) + 1);
    return m;
  };
  const diff = (a, b) => {
    // Items in multiset a not in multiset b (with counts).
    const mb = countMap(b);
    const out = [];
    for (const n of a) {
      if ((mb.get(n) ?? 0) > 0) mb.set(n, mb.get(n) - 1);
      else out.push(n);
    }
    return out;
  };
  const declaredAll = declaredByContract.flatMap(([, s]) => s);
  const phantom = diff(executed, declaredAll);
  if (phantom.length > 0) {
    return `source cross-check: ${file} reports tests not declared in ${spec.dir}: ${phantom.join(", ")}`;
  }
  const missing = diff(declaredAll, executed);
  if (missing.length === 0) {
    if (skippedSetUps > 0) {
      return `source cross-check: ${file} has ${skippedSetUps} skipped setUp() entr${skippedSetUps === 1 ? "y" : "ies"} but no declared test is missing — the skip justifies nothing`;
    }
    return null;
  }
  // Missing tests must be exactly whole skipped contracts, one skipped
  // setUp() per skipped contract. Brute-force the subset (<=8 contracts).
  const missingMap = countMap(missing);
  const sameMultiset = (a, b) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);
  const n = declaredByContract.length;
  let cover = null;
  for (let mask = 1; mask < 1 << n; mask++) {
    const union = [];
    let count = 0;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        count++;
        union.push(...declaredByContract[i][1]);
      }
    }
    if (sameMultiset(countMap(union), missingMap)) {
      cover = { count, names: declaredByContract.filter((_, i) => mask & (1 << i)).map(([c]) => c) };
      break;
    }
  }
  if (!cover) {
    return `source cross-check: ${file} is missing declared tests with no whole-contract setUp skip to explain them: ${missing.join(", ")}`;
  }
  if (skippedSetUps !== cover.count) {
    return `source cross-check: ${file} is missing all tests of ${cover.names.join(", ")} (${missing.length} tests) but has ${skippedSetUps} skipped setUp() entr${skippedSetUps === 1 ? "y" : "ies"} (expected ${cover.count})`;
  }
  return null;
}

function checkForgeAgainstSource(file, entries) {
  const spec = FORGE_SOURCE[file];
  if (!spec) return null;
  const byContract = parseSourceTests(spec.dir);
  if (byContract === null) {
    return `source dir ${spec.dir} missing — cannot cross-check counted tests against declared tests`;
  }
  if (spec.mode === "invariant") {
    const executed = entries.filter((e) => e.name !== "setUp").map((e) => e.name);
    return checkInvariantNames(byContract, executed, file);
  }
  if (spec.mode === "mixed") {
    // test/account/*: the invariant entries are checked by the
    // invariant rule and the rest by the unit rule. The partition is by
    // forge kind, so an invariant entry can never be diffed against the
    // declared test names (that false diff is what errored this file
    // before the fix: invariant_I10_feeAccounting is not a test… name).
    const invNames = entries
      .filter((e) => e.kindKey === "Invariant" && e.name !== "setUp")
      .map((e) => e.name);
    const invError = checkInvariantNames(byContract, invNames, file);
    if (invError) return invError;
    return checkUnitNames(byContract, entries.filter((e) => e.kindKey !== "Invariant"), file, spec);
  }
  return checkUnitNames(byContract, entries, file, spec);
}

// sha256 over a directory tree (sorted relative paths + contents), for
// the gitignored forge-std input hash. Returns null when absent.
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
  return { passed, failed, skipped, entries, unknown, mismatch };
}

// Vitest --reporter=json: { numTotalTests, numPassedTests,
// numFailedTests, numPendingTests, testResults: [...] }
//
// Count from testResults[].assertionResults, NOT from the top-level
// num*Tests: the per-test list is the only verifiable evidence — the
// top-level numbers are uncheckable on their own. (Committed run
// 2026-11-15, out/backend.json: 74 passed + 0 failed + 0 pending =
// 74 = numTotalTests, and out/backend.stderr is empty.)
//
// Completeness guard (J3-F3): when the report carries numTotalTests,
// sum(assertionResults) MUST equal it. Vitest prints "Some tests are
// still running when generating the JSON report" exactly when the report
// is truncated — a truncated report must never be counted as a clean
// pass. On mismatch the suite is marked "error" (see main()).
// A report with NO verifiable evidence at all — no per-test list and
// no numTotalTests (e.g. `{}`), or an empty per-test list with the
// totals stripped — is likewise an error, never completed 0/0/0: a
// zero-test suite that "passes" is a broken run, not a pass.
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
  // No per-test list and no usable numTotalTests: nothing verifiable.
  // (J3-F3: `{}` used to pass as completed 0/0/0.)
  return {
    passed: 0,
    failed: 0,
    skipped: 0,
    mismatch: "no per-test list and no numTotalTests — no verifiable test evidence (empty report)",
  };
}

function gitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
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
  // Raw forge JSON per file (real runs only, not markers), for the
  // per-file guards below (kind coverage + source cross-check).
  const forgeDataByFile = new Map();
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
    if (exp.file.startsWith("forge-")) forgeDataByFile.set(exp.file, data);
    // Totals guard (J3-F3): a report whose own totals do not reconcile is
    // an error, never a pass — even if every counted test passed. The
    // counted numbers are kept in the suite so the failure is diagnosable,
    // but the suite leaves "completed", so it is excluded from `total`
    // and the run exits 1.
    if (counts.mismatch) {
      suites.push({ name: exp.name, kind: exp.kind, passed: counts.passed, failed: counts.failed, skipped: counts.skipped, status: "error", note: counts.mismatch });
      continue;
    }
    const { mismatch: _mismatch, entries: _entries, unknown: _unknown, ...cleanCounts } = counts;
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

  // Per-file forge guards (J3-F1/F2): every entry in a forge file must
  // be counted by exactly one EXPECTED suite for that file, and the
  // executed test names must reconcile against the source-declared
  // ones. A violation adds an "error" suite (exit 1) — the counted
  // suites keep their numbers so the failure is diagnosable.
  for (const [file, data] of forgeDataByFile) {
    const entries = collectForgeEntries(data);
    const expectedKinds = new Set(
      EXPECTED.filter((e) => e.file === file).map((e) => e.kind)
    );
    const isForkFile = expectedKinds.has("fork");
    const presentKinds = new Set(
      entries.map((e) => (isForkFile ? "fork" : e.kindKey.toLowerCase()))
    );
    const unaccounted = [...presentKinds].filter((k) => !expectedKinds.has(k));
    if (unaccounted.length > 0) {
      const n = entries.filter((e) =>
        unaccounted.includes(isForkFile ? "fork" : e.kindKey.toLowerCase())
      ).length;
      suites.push({
        name: `unaccounted:${file}`,
        kind: "unit",
        passed: 0,
        failed: 0,
        skipped: 0,
        status: "error",
        note: `${n} entr${n === 1 ? "y" : "ies"} in ${file} of kind(s) ${unaccounted.join(", ")} have no EXPECTED suite — add one or the tests are silently uncounted`,
      });
    }
    const sourceError = checkForgeAgainstSource(file, entries);
    if (sourceError) {
      suites.push({
        name: `source-check:${file}`,
        kind: "unit",
        passed: 0,
        failed: 0,
        skipped: 0,
        status: "error",
        note: sourceError,
      });
    }
  }

  // Unlisted outputs / tests (J3-F4): an out/forge-*.json file EXPECTED
  // does not cover, or a .t.sol file outside the mapped match-path
  // dirs, is an error — a suite that exists but is not counted must
  // never be silently ignored (passing or failing). Non-forge JSONs in
  // out/ (e.g. backend-60s-rerun.json, a one-off diagnostic) are not
  // suite outputs and are ignored here.
  for (const f of files.map((p) => basename(p))) {
    if (/^forge-.*\.json$/.test(f) && !EXPECTED.some((e) => e.file === f)) {
      const data = readJson(join(outDir, f));
      const entries = data && typeof data === "object" && !data.status ? collectForgeEntries(data) : [];
      const failed = entries.filter((e) => e.status === "Failure").length;
      suites.push({
        name: `unlisted:${f}`,
        kind: "unit",
        passed: entries.filter((e) => e.status === "Success").length,
        failed,
        skipped: entries.filter((e) => e.status === "Skipped").length,
        status: "error",
        note: `unlisted forge output ${f} (${entries.length} entries, ${failed} failed) is not covered by EXPECTED — add it or remove the file`,
      });
    }
  }
  const mappedDirs = new Set(Object.values(FORGE_SOURCE).map((s) => s.dir));
  const testRoot = join(ROOT, "contracts/test");
  if (existsSync(testRoot)) {
    const walk = (d) => {
      for (const ent of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const p = join(d, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (ent.isFile() && ent.name.endsWith(".t.sol")) {
          const rel = p.slice(join(ROOT).length + 1).replace(/\\/g, "/");
          const dir = rel.slice(0, rel.lastIndexOf("/"));
          if (!mappedDirs.has(dir)) {
            // Only a file that DECLARES tests is an unlisted suite.
            // A helper .t.sol with no test/invariant functions
            // (e.g. contracts/test/Base.t.sol, the shared Signer/MockBase
            // bases) is not a suite and is not flagged.
            const src = readFileSync(p, "utf8")
              .replace(/\/\*[\s\S]*?\*\//g, " ")
              .replace(/\/\/[^\n]*/g, "");
            if (!/\bfunction\s+(test\w*|invariant_\w*)\s*\(/.test(src)) continue;
            suites.push({
              name: `unlisted:${rel}`,
              kind: "unit",
              passed: 0,
              failed: 0,
              skipped: 0,
              status: "error",
              note: `test file ${rel} declares tests but is outside the mapped match-path dirs (${[...mappedDirs].join(", ")}) — add a forge pass + EXPECTED entry or remove it`,
            });
          }
        }
      }
    };
    walk(testRoot);
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
  // is nonForkDeclared + forkDeclared + 11: forge executes each invariant
  // suite as ONE test although the files declare 14 invariant properties
  // (3 in Invariant.t.sol + 1 in RouterInvariant.t.sol + 10 in
  // account/Invariant.t.sol), executed as 3 entries, and the fork
  // suites (offline/testnet/mainnet) are the SAME 10 tests listed three
  // times, counted once here via the testnet run. Example on the
  // pre-merge tree: 186 non-fork declared + 10 fork + 2 invariant
  // properties = 198 distinct declared (C12) vs 179 passed non-fork.
  // passedInclFork counts each distinct fork test ONCE, via the testnet
  // run: the mainnet run's 7 passed test names are a strict subset of
  // the testnet run's 10 (mainnet − {setUp} ⊆ testnet), so adding
  // mainnet.passed as well double-counts 7 tests — the old formula gave
  // 512 (495 + 10 + 7); the honest distinct count is 505 (495 + 10).
  const nonForkDeclared = suites
    .filter((s) => s.kind !== "fork" && s.status === "completed")
    .reduce((n, s) => n + s.passed + s.failed + s.skipped, 0);
  const forkTestnetSuite = suites.find((s) => s.name === "contracts-fork-testnet");
  const forkDeclared =
    forkTestnetSuite?.status === "completed"
      ? forkTestnetSuite.passed + forkTestnetSuite.failed + forkTestnetSuite.skipped
      : null;
  const passedInclFork =
    total.passed +
    (forkTestnetSuite?.status === "completed" ? forkTestnetSuite.passed : 0);
  const reconciliation = {
    nonForkDeclared,
    forkDeclared,
    passedInclFork,
    note: "total.passed is a NON-FORK subtotal (fork suites listed separately, never added twice). Distinct declared tests = nonForkDeclared + forkDeclared + 11 (forge counts each invariant suite as 1 executed test; the files declare 14 invariant properties). passedInclFork counts each distinct fork test once, via the testnet run — the mainnet run's passed tests are a subset of the testnet run's, so they are not added again. Do not read total.passed as 'N in total'.",
  };

  const result = {
    generatedAt: new Date().toISOString(),
    commit: gitCommit(),
    inputs: { forgeStdHash: hashDir("contracts/lib/forge-std/src") },
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
  console.log(`reconciliation: non-fork declared=${nonForkDeclared}, fork declared=${forkDeclared ?? "n/a"}, passed incl. fork=${passedInclFork}, distinct declared=${forkDeclared === null ? "n/a" : nonForkDeclared + forkDeclared + 11} (C12: +11 invariant properties)`);
  process.exit(failed || errored ? 1 : 0);
}

main();
