import { migrations } from "./migrations.js";
import type { Db } from "./pool.js";

export async function migrate(db: Db): Promise<number[]> {
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
  );
  const { rows } = await db.query<{ id: number }>("SELECT id FROM schema_migrations");
  const done = new Set(rows.map((r) => Number(r.id)));
  const applied: number[] = [];
  for (const m of migrations) {
    if (done.has(m.id)) continue;
    await db.query(m.sql);
    await db.query("INSERT INTO schema_migrations (id, name) VALUES ($1, $2)", [m.id, m.name]);
    applied.push(m.id);
  }
  return applied;
}
