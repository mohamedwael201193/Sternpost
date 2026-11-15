import { describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Transport-level test (J3 F1): over real MCP stdio transport the SDK
 * parses args against the zod schemas, so unknown/credential fields are
 * dropped by the transport and never reach a handler. This spawns the
 * server via tsx (devDependency — no build step needed) and calls
 * request_session with privateKey/apiKey args, asserting the call succeeds
 * and the sentinel never appears in the response.
 */
const SENTINEL = "sk-transport-sentinel-never-returned-4d91";

function startServer(env: NodeJS.ProcessEnv): ChildProcessWithoutNullStreams {
  const tsx = new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url).pathname;
  const entry = new URL("../src/index.ts", import.meta.url).pathname;
  return spawn(process.execPath, [tsx, entry], { stdio: ["pipe", "pipe", "pipe"], env });
}

function createRpcClient(child: ChildProcessWithoutNullStreams) {
  let buf = "";
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  child.stdout.on("data", (chunk: Buffer) => {
    buf += chunk.toString();
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg: { id?: number; result?: Record<string, unknown>; error?: unknown };
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id)!;
        pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result ?? {});
      }
    }
  });
  return {
    send: (method: string, params: Record<string, unknown>) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
        setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 20_000);
      }),
    notify: (method: string) => {
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n");
    },
  };
}

describe("stdio transport (J3 F1)", () => {
  it(
    "advertises exactly the plan §5.1 four tools, and drops credential fields before the handler",
    async () => {
      const tmp = await mkdtemp(join(tmpdir(), "sternpost-mcp-transport-"));
      const child = startServer({
        ...process.env,
        STERNPOST_AGENT_KEY_FILE: join(tmp, "agent.json"),
        STERNPOST_API: "http://127.0.0.1:9",
      });
      const rpc = createRpcClient(child);
      try {
        await rpc.send("initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "sternpost-transport-test", version: "0.1.0" },
        });
        rpc.notify("notifications/initialized");
        const tools = await rpc.send("tools/list", {});
        const names = (tools.tools as { name: string }[]).map((t) => t.name).sort();
        expect(names).toEqual(["balance", "pay", "radar", "request_session"]);
        const res = await rpc.send("tools/call", {
          name: "request_session",
          arguments: {
            account: "0x1bF45cFE654a397F4FF3B33bC1b157c88Ee71F38",
            purpose: "transport test",
            budget: "1",
            privateKey: SENTINEL,
            apiKey: SENTINEL,
          },
        });
        const text = (res.content as { text: string }[])[0].text;
        const parsed = JSON.parse(text);
        expect(parsed.ok).toBe(true);
        expect(parsed.status).toBe("pending");
        expect(parsed.agent).toMatch(/^0x[0-9a-fA-F]{40}$/);
        expect(text).not.toContain(SENTINEL);
        expect(text).not.toContain("privateKey");
      } finally {
        child.kill();
        await rm(tmp, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
