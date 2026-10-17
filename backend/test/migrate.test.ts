import { describe, it, expect } from "vitest";
import { memDb } from "./helpers.js";
import { migrate } from "../src/db/migrate.js";
import { migrations } from "../src/db/migrations.js";

describe("migrations", () => {
  it("applies all migrations once and is idempotent", async () => {
    const db = await memDb();
    expect(await migrate(db)).toEqual([]);
    const { rows } = await db.query("SELECT id FROM schema_migrations ORDER BY id");
    expect(rows.map((r: any) => r.id)).toEqual(migrations.map((m) => m.id));
  });
  it("has strictly increasing ids", () => {
    migrations.forEach((m, i) => i && expect(m.id).toBeGreaterThan(migrations[i - 1].id));
  });
});
