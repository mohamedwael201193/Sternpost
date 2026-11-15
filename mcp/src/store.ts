import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { agentKeyPath } from "./agentKey.js";
import type { McpEnv } from "./config.js";

/**
 * Local record of session requests (plan §5.1: request_session returns a
 * request id and the approval link; the owner approves in Crew / Telegram
 * and the agent polls with `balance`). Requests are stored next to the
 * agent key file, chmod 600, and never contain a private key.
 */

export interface SessionRequest {
  requestId: string;
  account: string;
  agent: string;
  purpose: string;
  budget: string;
  perTx: string | null;
  days: number;
  payees: string[];
  sandbox: boolean;
  status: "pending" | "approved" | "denied" | "sandbox_granted";
  approveUrl: string;
  telegram: "sent" | "not_linked";
  createdAt: string;
}

export function newRequestId(): string {
  return `req_${randomBytes(8).toString("hex")}`;
}

export async function storeSessionRequest(env: McpEnv, req: SessionRequest): Promise<string> {
  const dir = join(dirname(agentKeyPath(env)), "requests");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${req.requestId}.json`);
  await writeFile(path, JSON.stringify(req, null, 2) + "\n", { mode: 0o600 });
  return path;
}
