import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../db/pool.js";
import { address, parseBody, uintString } from "../lib/validate.js";

const policySchema = z
  .object({ governor: address, borrower: address, floorICR: uintString, defendICR: uintString })
  .refine((p) => BigInt(p.defendICR) >= BigInt(p.floorICR), { message: "defendICR must be >= floorICR" })
  .refine((p) => BigInt(p.floorICR) >= 1_100_000_000_000_000_000n, { message: "floorICR below Mezo MCR (110%)" });

export function policiesRoutes(db: Db) {
  const r = new Hono();

  r.get("/policies/:governor", async (c) => {
    const g = address.safeParse(c.req.param("governor"));
    if (!g.success) return c.json({ error: "validation_error" }, 400);
    const { rows } = await db.query("SELECT * FROM policies WHERE governor = $1", [g.data]);
    if (!rows.length) return c.json({ error: "not_found" }, 404);
    return c.json({ policy: rows[0] });
  });

  /** Mirror of on-chain policy (the chain is the source of truth; the indexer also upserts here). */
  r.put("/policies", async (c) => {
    const body = await parseBody(c, policySchema);
    if (body instanceof Response) return body;
    const { rows } = await db.query(
      `INSERT INTO policies (governor, borrower, floor_icr, defend_icr) VALUES ($1,$2,$3,$4)
       ON CONFLICT (governor) DO UPDATE SET floor_icr = EXCLUDED.floor_icr, defend_icr = EXCLUDED.defend_icr, updated_at = now()
       RETURNING *`,
      [body.governor, body.borrower, body.floorICR, body.defendICR],
    );
    return c.json({ policy: rows[0] });
  });

  return r;
}
