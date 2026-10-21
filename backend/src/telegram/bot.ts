import { randomBytes } from "node:crypto";
import { formatUnits, verifyMessage } from "viem";
import type { Db } from "../db/pool.js";
import type { Keyboard, TelegramApi } from "./api.js";
import type { ChainReader, Hex } from "./chain.js";

export interface BotDeps {
  db: Db;
  tg: TelegramApi;
  chain: ChainReader;
  appUrl: string; // dashboard origin, e.g. https://sternpost-pink.vercel.app
  apiUrl: string; // public API origin that serves the /tg/link signing page
  alertMarginBps?: number; // alert when ICR is within this margin above the floor (default 10%)
  linkTtlSec?: number;
}

export interface Update {
  message?: { chat: { id: number }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number } } };
}

export const linkMessage = (code: string) => `Link Telegram to Sternpost\nCode: ${code}`;
const addrRe = /^0x[0-9a-fA-F]{40}$/;
const sigRe = /^0x[0-9a-fA-F]{130,}$/;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const ratio = (x: bigint) => (Number(x / 10n ** 14n) / 10_000).toFixed(2);
export const amt = (x: bigint) => Number(formatUnits(x, 18)).toLocaleString("en-US", { maximumFractionDigits: 4 });

const HELP = [
  "<b>Sternpost</b> watches your Mezo trove and your agent's MUSD draws.",
  "/link connect your wallet (you sign one message, no transaction)",
  "/status ICR, floor, defend line and buffer",
  "/balances MUSD and MEZO in your wallet",
  "/requests pending agent draw requests",
  "/revoke open the app to freeze all draws",
  "/unlink disconnect this chat",
  "The bot never holds keys. Every approval and revoke is signed by you in your wallet and enforced on chain.",
].join("\n");

export function createBot(d: BotDeps) {
  const margin = BigInt(d.alertMarginBps ?? 1000);
  const ttl = d.linkTtlSec ?? 600;

  const user = async (chatId: number) =>
    (await d.db.query<{ address: Hex; governor: Hex | null }>("SELECT address, governor FROM tg_users WHERE chat_id = $1", [chatId])).rows[0];

  const governorFor = async (chatId: number, address: Hex, cached: Hex | null) => {
    if (cached) return cached;
    const g = await d.chain.governorOf(address);
    if (g) await d.db.query("UPDATE tg_users SET governor = $1 WHERE chat_id = $2", [g, chatId]);
    return g;
  };

  const requestCard = (r: { id: number; app_address: string; amount: string; reason?: string | null }): [string, Keyboard] => [
    `<b>Draw request #${r.id}</b>\nApp ${short(r.app_address)} asks <b>${amt(BigInt(r.amount))} MUSD</b>${r.reason ? `\nReason: ${escape(r.reason)}` : ""}\n\nApprove signs an on-chain budget for this app in your wallet. Nothing moves until that transaction lands.`,
    [
      [{ text: "Approve in wallet", url: `${d.appUrl}/app/apps?app=${r.app_address}&amount=${r.amount}&request=${r.id}` }],
      [{ text: "I signed, verify", callback_data: `verify:${r.id}` }, { text: "Deny", callback_data: `deny:${r.id}` }],
    ],
  ];

  async function startLink(chatId: number) {
    const code = randomBytes(8).toString("hex");
    await d.db.query("DELETE FROM tg_link_codes WHERE chat_id = $1 OR expires_at < now()", [chatId]);
    await d.db.query(`INSERT INTO tg_link_codes (code, chat_id, expires_at) VALUES ($1, $2, now() + ($3 || ' seconds')::interval)`, [code, chatId, String(ttl)]);
    await d.tg.send(
      chatId,
      `Sign this message with your borrower wallet to link it (valid ${Math.round(ttl / 60)} min):\n<code>${linkMessage(code)}</code>\n\nOpen the signing page, or sign it anywhere and send:\n<code>/verify 0xYourAddress 0xSignature</code>`,
      [[{ text: "Sign in wallet", url: `${d.apiUrl}/tg/link?code=${code}` }]],
    );
    return code;
  }

  /** Verifies a personal_sign over linkMessage(code) and binds the signer to the chat that requested the code. */
  async function completeLink(code: string, address: string, signature: string, chatId?: number) {
    if (!addrRe.test(address) || !sigRe.test(signature) || !/^[0-9a-f]{16}$/.test(code)) return { ok: false as const, error: "validation_error" };
    const { rows } = await d.db.query<{ chat_id: string }>("SELECT chat_id FROM tg_link_codes WHERE code = $1 AND expires_at > now()", [code]);
    if (!rows.length) return { ok: false as const, error: "code_expired" };
    const owner = Number(rows[0].chat_id);
    if (chatId !== undefined && chatId !== owner) return { ok: false as const, error: "code_expired" };
    const valid = await verifyMessage({ address: address as Hex, message: linkMessage(code), signature: signature as Hex }).catch(() => false);
    if (!valid) return { ok: false as const, error: "bad_signature" };
    const a = address.toLowerCase() as Hex;
    await d.db.query("DELETE FROM tg_link_codes WHERE code = $1", [code]);
    const g = await d.chain.governorOf(a).catch(() => null);
    const max = (await d.db.query<{ m: number | null }>("SELECT max(id) AS m FROM draw_requests WHERE borrower = $1", [a])).rows[0]?.m ?? 0;
    await d.db.query(
      `INSERT INTO tg_users (chat_id, address, governor, last_request_id) VALUES ($1,$2,$3,$4)
       ON CONFLICT (chat_id) DO UPDATE SET address = EXCLUDED.address, governor = EXCLUDED.governor, alerted_at = NULL, last_request_id = EXCLUDED.last_request_id`,
      [owner, a, g, Number(max)],
    );
    await d.tg.send(owner, `Linked ${short(a)}${g ? `. Governor ${short(g)}.` : ". No governor yet: create one in the app."}\nTry /status.`);
    return { ok: true as const, address: a, chatId: owner };
  }

  async function status(chatId: number) {
    const u = await user(chatId);
    if (!u) return d.tg.send(chatId, "No wallet linked. Send /link first.");
    const g = await governorFor(chatId, u.address, u.governor);
    if (!g) return d.tg.send(chatId, `Wallet ${short(u.address)} has no Sternpost governor yet.`, [[{ text: "Open app", url: `${d.appUrl}/app` }]]);
    const s = await d.chain.status(g);
    const near = s.icr < (s.floor * (10_000n + margin)) / 10_000n;
    return d.tg.send(
      chatId,
      [
        `<b>${s.frozen ? "FROZEN" : near ? "Near floor" : "Healthy"}</b>  ·  governor ${short(g)}`,
        `ICR ${ratio(s.icr)}  ·  floor ${ratio(s.floor)}  ·  defend ${ratio(s.defend)}`,
        `Buffer ${amt(s.buffer)} MUSD`,
      ].join("\n"),
      [[{ text: "Dashboard", url: `${d.appUrl}/app` }]],
    );
  }

  async function balances(chatId: number) {
    const u = await user(chatId);
    if (!u) return d.tg.send(chatId, "No wallet linked. Send /link first.");
    const b = await d.chain.balances(u.address);
    return d.tg.send(chatId, `Wallet ${short(u.address)}\nMUSD ${amt(b.musd)}\nMEZO ${amt(b.mezo)}`);
  }

  async function requests(chatId: number) {
    const u = await user(chatId);
    if (!u) return d.tg.send(chatId, "No wallet linked. Send /link first.");
    const { rows } = await d.db.query("SELECT * FROM draw_requests WHERE borrower = $1 AND status = 'pending' ORDER BY id DESC LIMIT 5", [u.address]);
    if (!rows.length) return d.tg.send(chatId, "No pending requests.");
    for (const r of rows) await d.tg.send(chatId, ...requestCard(r));
  }

  async function revoke(chatId: number) {
    const u = await user(chatId);
    if (!u) return d.tg.send(chatId, "No wallet linked. Send /link first.");
    return d.tg.send(chatId, "Revoke freezes every draw and burns your outstanding Mezo signature nonce. You sign it in your wallet; the bot cannot do it for you.", [
      [{ text: "Revoke in wallet", url: `${d.appUrl}/app/revoke` }],
    ]);
  }

  /** Deny is a plain refusal; verify reads the on-chain allowance and only then marks the request approved. */
  async function callback(cb: NonNullable<Update["callback_query"]>) {
    const chatId = cb.message?.chat.id;
    const m = /^(deny|verify):(\d+)$/.exec(cb.data ?? "");
    if (!chatId || !m) return d.tg.answer(cb.id, "Unknown action");
    const u = await user(chatId);
    const req = (await d.db.query("SELECT * FROM draw_requests WHERE id = $1", [Number(m[2])])).rows[0];
    if (!u || !req || req.borrower !== u.address) return d.tg.answer(cb.id, "Not your request");
    if (req.status !== "pending") return d.tg.answer(cb.id, `Already ${req.status}`);
    if (m[1] === "deny") {
      await d.db.query("UPDATE draw_requests SET status = 'rejected', updated_at = now() WHERE id = $1 AND status = 'pending'", [req.id]);
      await d.tg.answer(cb.id, "Denied");
      return d.tg.send(chatId, `Request #${req.id} denied. The app has no new budget.`);
    }
    const g = await governorFor(chatId, u.address, u.governor);
    if (!g) return d.tg.answer(cb.id, "No governor on chain");
    const [a, now] = await Promise.all([d.chain.allowance(g, req.app_address as Hex), d.chain.now()]);
    if (a.expiry <= now || a.remaining < BigInt(req.amount)) {
      return d.tg.answer(cb.id, "Not on chain yet. Sign the budget in your wallet first.");
    }
    await d.db.query("UPDATE draw_requests SET status = 'approved', updated_at = now() WHERE id = $1 AND status = 'pending'", [req.id]);
    await d.tg.answer(cb.id, "Verified on chain");
    return d.tg.send(chatId, `Request #${req.id} approved. On-chain budget left for this app: ${amt(a.remaining)} MUSD.`);
  }

  async function handle(up: Update) {
    if (up.callback_query) return callback(up.callback_query);
    const msg = up.message;
    if (!msg?.text) return;
    const chatId = msg.chat.id;
    const [cmd, ...args] = msg.text.trim().split(/\s+/);
    switch (cmd.split("@")[0].toLowerCase()) {
      case "/start":
      case "/help":
        return d.tg.send(chatId, HELP);
      case "/link":
        return void (await startLink(chatId));
      case "/verify": {
        const code = (await d.db.query<{ code: string }>("SELECT code FROM tg_link_codes WHERE chat_id = $1 AND expires_at > now()", [chatId])).rows[0]?.code;
        if (!code) return d.tg.send(chatId, "No active link code. Send /link first.");
        const r = await completeLink(code, args[0] ?? "", args[1] ?? "", chatId);
        if (!r.ok) return d.tg.send(chatId, r.error === "bad_signature" ? "Signature does not match that address." : "Usage: /verify 0xAddress 0xSignature");
        return;
      }
      case "/status":
        return status(chatId);
      case "/balances":
        return balances(chatId);
      case "/requests":
        return requests(chatId);
      case "/revoke":
        return revoke(chatId);
      case "/unlink":
        await d.db.query("DELETE FROM tg_users WHERE chat_id = $1", [chatId]);
        return d.tg.send(chatId, "Unlinked. No data about this chat is kept.");
      default:
        return d.tg.send(chatId, HELP);
    }
  }

  /** Push a newly created draw request to every chat linked to the borrower. */
  async function notifyRequest(r: { id: number; borrower: string; app_address: string; amount: string; reason?: string | null }) {
    const { rows } = await d.db.query<{ chat_id: string }>("SELECT chat_id FROM tg_users WHERE address = $1", [r.borrower]);
    for (const u of rows) {
      await d.tg.send(Number(u.chat_id), ...requestCard(r));
      await d.db.query("UPDATE tg_users SET last_request_id = GREATEST(last_request_id, $1) WHERE chat_id = $2", [r.id, u.chat_id]);
    }
  }

  /** Periodic sweep: ICR-near-floor alerts (at most once per hour per chat) and any requests not yet pushed. */
  async function tick() {
    const { rows } = await d.db.query<{ chat_id: string; address: Hex; governor: Hex | null; alerted_at: Date | null; last_request_id: number }>("SELECT * FROM tg_users");
    let alerts = 0, pushed = 0;
    for (const u of rows) {
      const chatId = Number(u.chat_id);
      try {
        const g = await governorFor(chatId, u.address, u.governor);
        if (g) {
          const s = await d.chain.status(g);
          const near = s.icr < (s.floor * (10_000n + margin)) / 10_000n;
          const recent = u.alerted_at && Date.now() - new Date(u.alerted_at).getTime() < 3_600_000;
          if (near && !recent) {
            await d.tg.send(chatId, `<b>ICR alert</b>: ${ratio(s.icr)} is close to your floor ${ratio(s.floor)} (defend ${ratio(s.defend)}). New draws that cross the floor revert on chain. Add collateral or repay to widen the gap.`, [[{ text: "Open dashboard", url: `${d.appUrl}/app` }], [{ text: "Revoke in wallet", url: `${d.appUrl}/app/revoke` }]]);
            await d.db.query("UPDATE tg_users SET alerted_at = now() WHERE chat_id = $1", [chatId]);
            alerts++;
          } else if (!near && u.alerted_at) {
            await d.db.query("UPDATE tg_users SET alerted_at = NULL WHERE chat_id = $1", [chatId]);
          }
        }
        const fresh = await d.db.query("SELECT * FROM draw_requests WHERE borrower = $1 AND status = 'pending' AND id > $2 ORDER BY id LIMIT 5", [u.address, u.last_request_id]);
        for (const r of fresh.rows) {
          await d.tg.send(chatId, ...requestCard(r));
          await d.db.query("UPDATE tg_users SET last_request_id = GREATEST(last_request_id, $1) WHERE chat_id = $2", [r.id, chatId]);
          pushed++;
        }
      } catch {
        /* one bad chat or RPC hiccup must not stop the sweep */
      }
    }
    return { users: rows.length, alerts, pushed };
  }

  return { handle, startLink, completeLink, notifyRequest, tick };
}
export type Bot = ReturnType<typeof createBot>;

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
