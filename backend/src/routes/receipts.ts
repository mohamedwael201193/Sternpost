import { Hono } from "hono";
import type { Db } from "../db/pool.js";
import { address } from "../lib/validate.js";

export function receiptsRoutes(db: Db) {
  const r = new Hono();
  r.get("/receipts", async (c) => {
    const p = address.optional().safeParse(c.req.query("payer"));
    if (!p.success) return c.json({ error: "validation_error" }, 400);
    const { rows } = p.data
      ? await db.query("SELECT * FROM receipts WHERE payer = $1 ORDER BY id DESC LIMIT 100", [p.data])
      : await db.query("SELECT * FROM receipts ORDER BY id DESC LIMIT 100");
    return c.json({ receipts: rows });
  });
  r.get("/receipts/:tx", async (c) => {
    const tx = c.req.param("tx");
    if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) return c.json({ error: "validation_error" }, 400);
    const { rows } = await db.query("SELECT * FROM receipts WHERE tx_hash = $1", [tx.toLowerCase()]);
    if (!rows.length) return c.json({ error: "not_found" }, 404);
    return c.json({ receipt: rows[0] });
  });
  return r;
}
