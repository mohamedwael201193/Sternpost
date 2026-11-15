import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { McpEnv } from "./config.js";

/**
 * Local agent key (plan §5.1): STERNPOST_AGENT_KEY_FILE, default
 * ~/.sternpost/agent.json, chmod 600, created by `request_session` if
 * absent. The key is NEVER returned in a tool result or logged — only the
 * derived agent address ever leaves this module.
 */

export function agentKeyPath(env: McpEnv): string {
  if (env.STERNPOST_AGENT_KEY_FILE) return resolve(env.STERNPOST_AGENT_KEY_FILE);
  return join(homedir(), ".sternpost", "agent.json");
}

export interface AgentKey {
  privateKey: `0x${string}`;
  address: `0x${string}`;
}

/** Load the key file if it exists, else null. Throws on a malformed file (never silently generates over it). */
export async function loadAgentKey(env: McpEnv): Promise<AgentKey | null> {
  let raw: string;
  try {
    raw = await readFile(agentKeyPath(env), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("agent key file is not valid JSON — fix or delete it and re-run request_session");
  }
  const privateKey = (parsed as { privateKey?: unknown }).privateKey;
  if (typeof privateKey !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("agent key file has no valid 0x privateKey — fix or delete it and re-run request_session");
  }
  const key = privateKey as `0x${string}`;
  return { privateKey: key, address: privateKeyToAccount(key).address };
}

/** Load the key, generating + storing it (chmod 600) when absent. Returns the key and whether it was just created. */
export async function loadOrCreateAgentKey(env: McpEnv): Promise<{ key: AgentKey; created: boolean }> {
  const existing = await loadAgentKey(env);
  if (existing) return { key: existing, created: false };
  const privateKey = generatePrivateKey();
  const key: AgentKey = { privateKey, address: privateKeyToAccount(privateKey).address };
  const path = agentKeyPath(env);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ address: key.address, privateKey }, null, 2) + "\n", { mode: 0o600 });
  return { key, created: true };
}

/** The agent address if a key file exists, else null (no key is ever created by a read). */
export async function loadAgentAddress(env: McpEnv): Promise<`0x${string}` | null> {
  const key = await loadAgentKey(env);
  return key ? key.address : null;
}
