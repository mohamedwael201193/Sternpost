/**
 * MCP stdio smoke test: spawns the built server, runs the JSON-RPC
 * handshake, lists tools, and calls all 4 plan §5.1 tools.
 * No Claude Code install needed; `claude mcp add` registers this same
 * command line (see README.md).
 *
 * Live mode (default): STERNPOST_RPC_URL=https://rpc.test.mezo.org.
 *   - balance with no account → ACCOUNT_NOT_SET refusal (no account
 *     has been opened on the live 1.9 system yet; see LIVE_EVIDENCE.md).
 *   - radar without an account → live system health + frontier.
 *   - request_session over stdio with credential fields → the transport
 *     drops them; the response never contains the sentinel (J3 F1).
 *   - pay dryRun with no account → ACCOUNT_NOT_SET refusal.
 * Fork mode: STERNPOST_FORK=1 with STERNPOST_RPC_URL=http://127.0.0.1:8545,
 * STERNPOST_ACCOUNT=<fork account>, STERNPOST_AGENT_KEY_FILE=<fork key>,
 * STERNPOST_RADAR=<fork radar> (written by scripts/fork-setup.mjs):
 *   - balance returns the full session, radar ranks the fork account,
 *     pay dryRun parses the real demo.vativ.io 402 + previewDraw.
 *
 * Usage: node scripts/mcp-smoke.mjs [path/to/dist/index.js]
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const serverPath = resolve(process.argv[2] ?? new URL("../dist/index.js", import.meta.url).pathname);
const FORK = process.env.STERNPOST_FORK === "1";
const ACCOUNT = process.env.STERNPOST_ACCOUNT;
const SENTINEL = "sk-smoke-sentinel-never-returned-7c31";

// Smoke hygiene: request_session generates a local agent key; keep it in a
// temp file unless the caller set STERNPOST_AGENT_KEY_FILE (fork mode does).
const childEnv = { ...process.env };
if (!childEnv.STERNPOST_AGENT_KEY_FILE) {
  childEnv.STERNPOST_AGENT_KEY_FILE = "/tmp/sternpost-mcp-smoke-agent.json";
}

const child = spawn(process.execPath, [serverPath], {
  stdio: ["pipe", "pipe", "inherit"],
  env: childEnv,
});

let buf = "";
let nextId = 1;
const pending = new Map();
const notifications = [];

function send(method, params) {
  const id = nextId++;
  const msg = { jsonrpc: "2.0", id, method, params };
  child.stdin.write(JSON.stringify(msg) + "\n");
  return new Promise((resolvePromise, reject) => {
    pending.set(id, { resolvePromise, reject });
    setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 60_000);
  });
}

function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

child.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolvePromise, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolvePromise(msg.result);
    } else if (msg.method) {
      notifications.push(msg.method);
    }
  }
});

const fail = (err) => {
  console.error("SMOKE FAILED:", err?.message ?? err);
  child.kill();
  process.exit(1);
};

const textOf = (res) => res.content?.[0]?.text ?? "";
const mustNotContainKey = (text, label) => {
  if (text.includes(SENTINEL)) throw new Error(`${label} response contains the sentinel key`);
};

try {
  const init = await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "sternpost-smoke", version: "0.1.0" },
  });
  console.log("initialize ok:", JSON.stringify({ protocolVersion: init.protocolVersion, serverInfo: init.serverInfo }));
  notify("notifications/initialized");

  const tools = await send("tools/list");
  const names = tools.tools.map((t) => t.name);
  console.log("tools/list:", JSON.stringify(names));
  for (const want of ["balance", "pay", "request_session", "radar"]) {
    if (!names.includes(want)) throw new Error(`missing tool: ${want}`);
  }
  if (names.length !== 4) throw new Error(`expected exactly the plan §5.1 4 tools, got ${names.length}`);

  // balance
  const balance = await send("tools/call", { name: "balance", arguments: ACCOUNT ? { account: ACCOUNT } : {} });
  const balanceText = textOf(balance);
  console.log("balance call:\n" + balanceText);
  mustNotContainKey(balanceText, "balance");
  const bp = JSON.parse(balanceText);
  if (FORK) {
    if (bp.ok !== true || bp.session?.active !== true) throw new Error("fork balance: expected a live session");
    if (bp.health?.troveStatus !== "active") throw new Error("fork balance: expected an active trove");
  } else if (ACCOUNT) {
    if (bp.refused !== true || bp.reason !== "ACCOUNT_NOT_DEPLOYED") throw new Error("live balance with a non-TroveAccount address: expected ACCOUNT_NOT_DEPLOYED");
  } else if (bp.refused !== true || bp.reason !== "ACCOUNT_NOT_SET") {
    throw new Error("live balance with no account: expected ACCOUNT_NOT_SET");
  }

  // radar (no account: system health + frontier only — fast on live)
  const radar = await send("tools/call", { name: "radar", arguments: FORK && ACCOUNT ? { account: ACCOUNT } : {} });
  const radarText = textOf(radar);
  console.log("radar call:\n" + radarText);
  mustNotContainKey(radarText, "radar");
  const rp = JSON.parse(radarText);
  if (rp.ok !== true || rp.tcr <= 1 || rp.troveCount <= 0) throw new Error("radar result failed health check");
  if (FORK && (rp.rank <= 0 || rp.complete !== true)) throw new Error("fork radar: expected a ranked account");

  // request_session over stdio with credential fields (J3 F1 transport test)
  const reqArgs = {
    account: ACCOUNT ?? "0x1bF45cFE654a397F4FF3B33bC1b157c88Ee71F38",
    purpose: "smoke test",
    budget: "1",
    privateKey: SENTINEL,
    apiKey: SENTINEL,
  };
  const req = await send("tools/call", { name: "request_session", arguments: reqArgs });
  const reqText = textOf(req);
  console.log("request_session call:\n" + reqText);
  mustNotContainKey(reqText, "request_session");
  const qp = JSON.parse(reqText);
  if (qp.ok !== true || qp.status !== "pending" || !/^req_[0-9a-f]{16}$/.test(qp.requestId)) {
    throw new Error("request_session result failed pending/requestId check");
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(qp.agent)) throw new Error("request_session returned no agent address");

  // pay dryRun (no account on live → ACCOUNT_NOT_SET; on fork → real 402 + previewDraw)
  const pay = await send("tools/call", {
    name: "pay",
    arguments: { url: "https://demo.vativ.io/", dryRun: true },
  });
  const payText = textOf(pay);
  console.log("pay dryRun call:\n" + payText);
  mustNotContainKey(payText, "pay");
  const pp = JSON.parse(payText);
  if (FORK) {
    if (pp.status !== "dry_run" || pp.amount !== "0.001" || pp.preview?.allowed !== true) {
      throw new Error("fork pay dryRun: expected dry_run 0.001 with an allowed preview");
    }
  } else if (pp.refused !== true || pp.reason !== "ACCOUNT_NOT_SET") {
    throw new Error("live pay dryRun with no account: expected ACCOUNT_NOT_SET");
  }

  console.log(`SMOKE PASSED: 4 tools listed, all 4 called (${FORK ? "fork" : "live testnet"} mode)`);
  child.kill();
  process.exit(0);
} catch (err) {
  fail(err);
}
