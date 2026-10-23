import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../db/pool.js";
import { verifyMessage } from "viem";
import { address, parseBody, uintString } from "../lib/validate.js";

/** Exact text the borrower signs (EIP-191) to change a request. Bound to id, status, borrower and a short expiry. */
export const requestStatusMessage = (id: number, status: string, borrower: string, expiry: number) =>
  `Sternpost: mark draw request #${id} ${status}\nBorrower: ${borrower.toLowerCase()}\nExpires: ${expiry}`;
const MAX_SIG_TTL = 600;

const appSchema = z.object({
  name: z.string().trim().min(2).max(64),
  address,
  url: z.string().url().max(256).optional(),
  description: z.string().max(500).optional(),
});
const requestSchema = z.object({
  appAddress: address,
  borrower: address,
  amount: uintString,
  reason: z.string().max(280).optional(),
});
const statusSchema = z.object({
  status: z.enum(["approved", "rejected", "drawn"]),
  expiry: z.number().int().positive(),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130,}$/),
});

export type RequestHook = (r: { id: number; borrower: string; app_address: string; amount: string; reason?: string | null }) => Promise<void>;

export function appsRoutes(db: Db, onRequest?: RequestHook) {
  const r = new Hono();

  r.get("/apps", async (c) => {
    const { rows } = await db.query("SELECT * FROM apps ORDER BY id DESC LIMIT 200");
    return c.json({ apps: rows });
  });

  r.post("/apps", async (c) => {
    const body = await parseBody(c, appSchema);
    if (body instanceof Response) return body;
    const dup = await db.query("SELECT id FROM apps WHERE address = $1", [body.address]);
    if (dup.rows.length) return c.json({ error: "app_exists" }, 409);
    const { rows } = await db.query(
      "INSERT INTO apps (name, address, url, description) VALUES ($1,$2,$3,$4) RETURNING *",
      [body.name, body.address, body.url ?? null, body.description ?? null],
    );
    return c.json({ app: rows[0] }, 201);
  });

  r.get("/requests", async (c) => {
    const b = address.optional().safeParse(c.req.query("borrower"));
    if (!b.success) return c.json({ error: "validation_error" }, 400);
    const { rows } = b.data
      ? await db.query("SELECT * FROM draw_requests WHERE borrower = $1 ORDER BY id DESC LIMIT 200", [b.data])
      : await db.query("SELECT * FROM draw_requests ORDER BY id DESC LIMIT 200");
    return c.json({ requests: rows });
  });

  r.post("/requests", async (c) => {
    const body = await parseBody(c, requestSchema);
    if (body instanceof Response) return body;
    const app = await db.query("SELECT id FROM apps WHERE address = $1", [body.appAddress]);
    if (!app.rows.length) return c.json({ error: "unknown_app" }, 404);
    const { rows } = await db.query(
      "INSERT INTO draw_requests (app_address, borrower, amount, reason) VALUES ($1,$2,$3,$4) RETURNING *",
      [body.appAddress, body.borrower, body.amount, body.reason ?? null],
    );
    // Push to linked Telegram chats; a notification failure never fails the request (the cron sweep retries).
    if (onRequest) await onRequest(rows[0]).catch(() => undefined);
    return c.json({ request: rows[0] }, 201);
  });

  r.patch("/requests/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "validation_error" }, 400);
    const body = await parseBody(c, statusSchema);
    if (body instanceof Response) return body;
    const now = Math.floor(Date.now() / 1000);
    if (body.expiry <= now || body.expiry > now + MAX_SIG_TTL) return c.json({ error: "signature_expired" }, 401);
    const cur = (await db.query("SELECT borrower, status FROM draw_requests WHERE id = $1", [id])).rows[0];
    if (!cur || cur.status !== "pending") return c.json({ error: "not_found_or_final" }, 404);
    const ok = await verifyMessage({
      address: cur.borrower,
      message: requestStatusMessage(id, body.status, cur.borrower, body.expiry),
      signature: body.signature as `0x${string}`,
    }).catch(() => false);
    if (!ok) return c.json({ error: "bad_signature" }, 401);
    // Replay-safe: the signature names one request and one status, and a request leaves 'pending' exactly once.
    const { rows } = await db.query(
      "UPDATE draw_requests SET status = $1, updated_at = now() WHERE id = $2 AND status = 'pending' RETURNING *",
      [body.status, id],
    );
    if (!rows.length) return c.json({ error: "not_found_or_final" }, 404);
    return c.json({ request: rows[0] });
  });

  return r;
}
