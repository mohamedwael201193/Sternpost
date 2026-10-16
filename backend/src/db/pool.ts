import pg from "pg";

export interface Db {
  query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export const createPool = (url: string): pg.Pool =>
  new pg.Pool({
    connectionString: url,
    max: 5,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
  });
