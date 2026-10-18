import { loadConfig } from "./config.js";
import { buildRuntime } from "./runtime.js";

let ready: ReturnType<typeof buildRuntime> | undefined;
/** Lazily builds one runtime per warm instance; indexer runs on demand (see /v1/indexer/sync). */
export async function handler(req: Request): Promise<Response> {
  ready ??= buildRuntime(loadConfig(), { poolMax: 2 }).catch((err) => {
    ready = undefined; // do not cache a failed cold start
    throw err;
  });
  const { app } = await ready;
  return app.fetch(req);
}
