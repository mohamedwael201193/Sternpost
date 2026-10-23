import { createPool } from "./pool.js";
import { migrate } from "./migrate.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const pool = createPool(url);
const applied = await migrate(pool);
console.log(JSON.stringify({ msg: "migrations applied", applied }));
await pool.end();
