/**
 * MCP stdio smoke test: spawns the built server, runs the JSON-RPC
 * handshake, lists tools, and calls `balance` against live testnet.
 * No Claude Code install needed; `claude mcp add` registers this same
 * command line (see README.md).
 *
 * Usage: node scripts/mcp-smoke.mjs [path/to/dist/index.js]
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const serverPath = resolve(process.argv[2] ?? new URL("../dist/index.js", import.meta.url).pathname);

const child = spawn(process.execPath, [serverPath], { stdio: ["pipe", "pipe", "inherit"] });

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
    setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 30_000);
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
  for (const want of ["balance", "preview_draw", "governor_status", "x402_quote"]) {
    if (!names.includes(want)) throw new Error(`missing tool: ${want}`);
  }
  if (names.length !== 4) throw new Error(`expected exactly 4 tools, got ${names.length}`);

  const balance = await send("tools/call", {
    name: "balance",
    arguments: { address: "0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3" },
  });
  const balanceText = balance.content?.[0]?.text ?? "";
  console.log("balance call:\n" + balanceText);
  const parsed = JSON.parse(balanceText);
  if (parsed.chainId !== 31611 || parsed.ok !== true) throw new Error("balance result failed chain/ok check");

  const status = await send("tools/call", { name: "governor_status", arguments: {} });
  console.log("governor_status call:\n" + (status.content?.[0]?.text ?? ""));

  const preview = await send("tools/call", {
    name: "preview_draw",
    arguments: {
      app: "0x0508F05fD26811139cf0C3e139FD692Ae7612D1E",
      amountMusd: "10",
      payee: "0x4F878203175B1BB6C63Ec02CEEBE1af4A7c9Ee4a",
    },
  });
  console.log("preview_draw call:\n" + (preview.content?.[0]?.text ?? ""));

  const quote = await send("tools/call", {
    name: "x402_quote",
    arguments: {
      route: "radar",
      app: "0x0508F05fD26811139cf0C3e139FD692Ae7612D1E",
      payee: "0x4F878203175B1BB6C63Ec02CEEBE1af4A7c9Ee4a",
    },
  });
  console.log("x402_quote call:\n" + (quote.content?.[0]?.text ?? ""));

  console.log("SMOKE PASSED: 4 tools listed, all 4 called against live testnet");
  child.kill();
  process.exit(0);
} catch (err) {
  fail(err);
}
