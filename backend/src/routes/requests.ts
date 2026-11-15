import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../db/pool.js";
import { address, parseBody, uintString } from "../lib/validate.js";
import type { FactoryChecker } from "../relayer/factory.js";

/**
 * Session requests (plan 5.1 `request_session`, task 5.2 sandbox auto-approve).
 *
 * POST /v1/session-requests — an agent asks an account owner for a spending
 * session. Two paths:
 *  - sandbox: true  -> the Sternpost team sandbox account (Lane B, testnet
 *    ONLY). Auto-approved up to SANDBOX_DAILY_CAP_MUSD MUSD/day per agent and
 *    SANDBOX_MAX_DAYS days. Returns status `sandbox_granted` with the grant.
 *    The grant is recorded here; the on-chain `SessionOpened` event appears
 *    only once the sandbox owner signs `setSession` — this endpoint never
 *    claims an on-chain session exists before that event lands.
 *  - sandbox: false -> status `pending` + an approve URL for the Crew page;
 *    the owner signs `setSession` in the browser. No auto-approval.
 *
 * Testnet only: the sandbox account lives on chain 31611 and this route
 * never touches mainnet (31612) — there is no mainnet sandbox account and
 * no mainnet auto-approve path. When no sandbox account is configured
 * (SANDBOX_ACCOUNT_ADDRESS unset — the case today: no sandbox TroveAccount
 * is deployed yet) sandbox requests return 503 `sandbox_not_configured`.
 *
 * NOTE: this is deliberately NOT /v1/requests — that path is the Wave 1
 * draw-request inbox (routes/apps.ts).
 */

export interface SessionRequestOpts {
  /** Team sandbox TroveAccount, or null while undeployed. */
  sandboxAccount: `0x${string}` | null;
  dailyCapMusd: string; // whole MUSD, e.g. "5"
  maxDays: number;
  appUrl: string;
  /** When set, non-sandbox requests for non-factory accounts are refused. */
  isAccount?: FactoryChecker;
}

const requestSchema = z.object({
  account: address,
  agent: address,
  purpose: z.string().trim().min(1).max(200),
  budget: uintString,
  perTx: uintString.optional(),
  dailyLimit: uintString.optional(),
  days: z.number().int().min(1).max(90).default(7),
  payees: z.array(address).max(10).optional(),
  sandbox: z.boolean().default(false),
});

const CAP = (musd: string) => BigInt(musd) * 10n ** 18n;

export function sessionRequestRoutes(db: Db, opts: SessionRequestOpts) {
  const r = new Hono();

  r.get("/session-requests", async (c) => {
    const b = address.optional().safeParse(c.req.query("account"));
    if (!b.success) return c.json({ error: "validation_error" }, 400);
    const { rows } = b.data
      ? await db.query("SELECT * FROM session_requests WHERE account = $1 ORDER BY id DESC LIMIT 200", [b.data])
      : await db.query("SELECT * FROM session_requests ORDER BY id DESC LIMIT 200");
    return c.json({ requests: rows });
  });

  r.post("/session-requests", async (c) => {
    const body = await parseBody(c, requestSchema);
    if (body instanceof Response) return body;
    const budget = BigInt(body.budget);
    const perTx = body.perTx ? BigInt(body.perTx) : null;
    const dailyLimit = body.dailyLimit ? BigInt(body.dailyLimit) : null;
    const cap = CAP(opts.dailyCapMusd);
    // Effective daily spend: explicit dailyLimit, else budget spread over the session.
    const effectiveDaily = dailyLimit ?? (budget + BigInt(body.days) - 1n) / BigInt(body.days);

    if (body.sandbox) {
      if (!opts.sandboxAccount) return c.json({ error: "sandbox_not_configured" }, 503);
      if (body.account !== opts.sandboxAccount) {
        return c.json({ error: "sandbox_account_mismatch", sandboxAccount: opts.sandboxAccount }, 400);
      }
      if (body.days > opts.maxDays) {
        return c.json({ error: "sandbox_cap_exceeded", reason: `days > ${opts.maxDays}` }, 400);
      }
      if (effectiveDaily > cap) {
        return c.json({ error: "sandbox_cap_exceeded", reason: `daily limit > ${opts.dailyCapMusd} MUSD` }, 400);
      }
      if (perTx !== null && perTx > effectiveDaily) {
        return c.json({ error: "sandbox_cap_exceeded", reason: "perTx > daily limit" }, 400);
      }
      const expiry = Math.floor(Date.now() / 1000) + body.days * 86_400;
      const { rows } = await db.query(
        `INSERT INTO session_requests (account, agent, purpose, budget, per_tx, daily_limit, days, payees, sandbox, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,'sandbox_granted') RETURNING *`,
        [body.account, body.agent, body.purpose, body.budget, body.perTx ?? null,
         dailyLimit ? body.dailyLimit : effectiveDaily.toString(), body.days, JSON.stringify(body.payees ?? [])],
      );
      return c.json({
        request: rows[0],
        status: "sandbox_granted",
        session: {
          account: opts.sandboxAccount,
          agent: body.agent,
          budget: body.budget,
          perTx: body.perTx ?? null,
          dailyLimit: dailyLimit ? body.dailyLimit : effectiveDaily.toString(),
          expiry,
          network: "testnet",
        },
        note: "Sandbox grant recorded. The on-chain SessionOpened event appears once the sandbox owner signs setSession.",
      }, 201);
    }

    if (opts.isAccount && !(await opts.isAccount(body.account as `0x${string}`))) {
      return c.json({ error: "not_factory_account" }, 403);
    }
    const { rows } = await db.query(
      `INSERT INTO session_requests (account, agent, purpose, budget, per_tx, daily_limit, days, payees, sandbox, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,FALSE,'pending') RETURNING *`,
      [body.account, body.agent, body.purpose, body.budget, body.perTx ?? null,
       body.dailyLimit ?? null, body.days, JSON.stringify(body.payees ?? [])],
    );
    return c.json({
      request: rows[0],
      status: "pending",
      approveUrl: `${opts.appUrl}/app/crew?request=${rows[0].id}`,
    }, 201);
  });

  return r;
}
