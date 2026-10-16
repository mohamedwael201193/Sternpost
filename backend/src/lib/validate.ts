import { z } from "zod";
import type { Context } from "hono";

export const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "invalid address").transform((a) => a.toLowerCase());
export const uintString = z.string().regex(/^\d{1,78}$/, "must be a base-10 integer string");

export async function parseBody<T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T> | Response> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const r = schema.safeParse(raw);
  if (!r.success) return c.json({ error: "validation_error", issues: r.error.issues }, 400);
  return r.data;
}
