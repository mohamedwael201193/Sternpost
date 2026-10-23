import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../db/pool.js";
import { address } from "../lib/validate.js";

const q = z.object({
  contract: address.optional(),
  event: z.string().regex(/^[A-Za-z]{1,40}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export function activityRoutes(db: Db) {
  const r = new Hono();
  r.get("/activity", async (c) => {
    const p = q.safeParse(c.req.query());
    if (!p.success) return c.json({ error: "validation_error", issues: p.error.issues }, 400);
    const where: string[] = [];
    const params: unknown[] = [];
    if (p.data.contract) { params.push(p.data.contract); where.push(`contract = $${params.length}`); }
    if (p.data.event) { params.push(p.data.event); where.push(`event = $${params.length}`); }
    params.push(p.data.limit);
    const sql = `SELECT tx_hash, log_index, block_number, contract, event, args, created_at FROM activity
      ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY block_number DESC, log_index DESC LIMIT $${params.length}`;
    const { rows } = await db.query(sql, params);
    return c.json({ activity: rows });
  });
  return r;
}
