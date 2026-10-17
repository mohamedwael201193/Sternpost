import { PGlite } from "@electric-sql/pglite";
import { migrate } from "../src/db/migrate.js";
import type { Db } from "../src/db/pool.js";
import { createApp, type AppDeps } from "../src/app.js";

export async function memDb(): Promise<Db> {
  const pg = new PGlite();
  const db: Db = { query: async (text, params) => {
    if (!params?.length && text.includes(";")) { await pg.exec(text); return { rows: [] }; }
    return (await pg.query(text, params as any[])) as any;
  } };
  await migrate(db);
  return db;
}

export const MUSD = "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503" as const;
export const PAYTO = "0x000000000000000000000000000000000000dEaD" as const;

export async function testApp(over: Partial<AppDeps> = {}) {
  const db = over.db ?? (await memDb());
  const app = createApp({
    db,
    corsOrigins: ["https://sternpost.vercel.app", "*.vercel.app"],
    rateLimitPerMin: 1000,
    snapshot: async () => ({ blockNumber: 123n }),
    pay: { facilitatorUrl: "https://fac.test", network: "eip155:31611", asset: MUSD, payTo: PAYTO, amount: "10000000000000000" },
    ...over,
  });
  return { app, db };
}

export { b64 } from "../src/x402/paywall.js";
export const json = (body: unknown, method = "POST") => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
