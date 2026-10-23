import { randomBytes } from "node:crypto";
import { formatUnits, verifyMessage } from "viem";
import type { Db } from "../db/pool.js";
import { notModified, type Keyboard, type TelegramApi } from "./api.js";
import { HELP, WELCOME, addr, backRow, balancesText, linkPrompt, linked, mainMenu, navRow, notLinked, parseCallback, requestKeyboard, requestText, stamp, statusText } from "./ui.js";
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
  callback_query?: { id: string; data?: string; message?: { chat: { id: number }; message_id?: number } };
}

export const linkMessage = (code: string) => `Link Telegram to Sternpost\nCode: ${code}`;
const addrRe = /^0x[0-9a-fA-F]{40}$/;
const sigRe = /^0x[0-9a-fA-F]{130,}$/;
export const ratio = (x: bigint) => (Number(x / 10n ** 14n) / 10_000).toFixed(2);
export const amt = (x: bigint) => Number(formatUnits(x, 18)).toLocaleString("en-US", { maximumFractionDigits: 4 });

/** Where a reply goes: a fresh message, or (from a button) an edit of the message that holds the button. */
type Ctx = { chatId: number; messageId?: number };

export function createBot(d: BotDeps) {
  const margin = BigInt(d.alertMarginBps ?? 1000);
  const ttl = d.linkTtlSec ?? 600;

  /** Edit in place when we can; fall back to a new message. A no-op edit (Refresh with no change) is fine. */
  const reply = async (c: Ctx, text: string, kb?: Keyboard) => {
    if (c.messageId !== undefined && d.tg.edit) {
      try { return await d.tg.edit(c.chatId, c.messageId, text, kb); } catch (e) { if (notModified(e)) return; }
    }
    return d.tg.send(c.chatId, text, kb);
  };

  const user = async (chatId: number) =>
    (await d.db.query<{ address: Hex; governor: Hex | null }>("SELECT address, governor FROM tg_users WHERE chat_id = $1", [chatId])).rows[0];

  const governorFor = async (chatId: number, address: Hex, cached: Hex | null) => {
    if (cached) return cached;
    const g = await d.chain.governorOf(address);
    if (g) await d.db.query("UPDATE tg_users SET governor = $1 WHERE chat_id = $2", [g, chatId]);
    return g;
  };

  const requestCard = (r: { id: number; app_address: string; amount: string; reason?: string | null }): [string, Keyboard] => [
    requestText({ id: r.id, app_address: r.app_address, amountFmt: amt(BigInt(r.amount)), reason: r.reason }),
    requestKeyboard(d.appUrl, r),
  ];

  async function startLink(chatId: number, c: Ctx = { chatId }) {
    const code = randomBytes(8).toString("hex");
    await d.db.query("DELETE FROM tg_link_codes WHERE chat_id = $1 OR expires_at < now()", [chatId]);
    await d.db.query(`INSERT INTO tg_link_codes (code, chat_id, expires_at) VALUES ($1, $2, now() + ($3 || ' seconds')::interval)`, [code, chatId, String(ttl)]);
    await reply(c, ...linkPrompt(linkMessage(code), Math.round(ttl / 60), `${d.apiUrl}/tg/link?code=${code}`));
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
    await d.tg.send(owner, linked(a, g), mainMenu(d.appUrl));
    return { ok: true as const, address: a, chatId: owner };
  }

  async function status(c: Ctx) {
    const u = await user(c.chatId);
    if (!u) return reply(c, ...notLinked());
    const g = await governorFor(c.chatId, u.address, u.governor);
    if (!g) return reply(c, `🧭 <b>Trove status</b>\n\nWallet ${addr(u.address)} has no Sternpost governor yet. Create one in the app.`, [[{ text: "🗺 Open app", url: `${d.appUrl}/app` }], navRow("status")]);
    const s = await d.chain.status(g);
    const near = s.icr < (s.floor * (10_000n + margin)) / 10_000n;
    return reply(
      c,
      statusText(s.frozen ? "frozen" : near ? "near" : "healthy", g, { icr: ratio(s.icr), floor: ratio(s.floor), defend: ratio(s.defend), buffer: amt(s.buffer) }),
      [[{ text: "🗺 Dashboard", url: `${d.appUrl}/app` }], navRow("status")],
    );
  }

  async function balances(c: Ctx) {
    const u = await user(c.chatId);
    if (!u) return reply(c, ...notLinked());
    const b = await d.chain.balances(u.address);
    return reply(c, balancesText(u.address, amt(b.musd), amt(b.mezo)), [navRow("balances")]);
  }

  async function requests(c: Ctx) {
    const u = await user(c.chatId);
    if (!u) return reply(c, ...notLinked());
    const { rows } = await d.db.query("SELECT * FROM draw_requests WHERE borrower = $1 AND status = 'pending' ORDER BY id DESC LIMIT 5", [u.address]);
    if (!rows.length) return reply(c, `📜 <b>Requests</b>\n\nNo pending requests. Your agents have not asked for MUSD.\n\n${stamp()}`, [navRow("requests")]);
    // One card per request so each keeps its own approve / verify / deny buttons; nav goes on the last card.
    for (const [i, r] of rows.entries()) {
      const [text, kb] = requestCard(r);
      const lastCard = i === rows.length - 1;
      await (i === 0 ? reply(c, text, lastCard ? [...kb, navRow("requests")] : kb) : d.tg.send(c.chatId, text, lastCard ? [...kb, navRow("requests")] : kb));
    }
  }

  async function revoke(c: Ctx) {
    const u = await user(c.chatId);
    if (!u) return reply(c, ...notLinked());
    return reply(c, "🛑 <b>Revoke</b>\n\nRevoke freezes every draw and burns your outstanding Mezo signature nonce. You sign it in your wallet; the bot cannot do it for you.", [
      [{ text: "Revoke in wallet", url: `${d.appUrl}/app/revoke` }],
      backRow(),
    ]);
  }

  const menu = (c: Ctx) => reply(c, WELCOME, mainMenu(d.appUrl));

  async function cancelLink(c: Ctx) {
    await d.db.query("DELETE FROM tg_link_codes WHERE chat_id = $1", [c.chatId]);
    return reply(c, "✖️ <b>Link cancelled</b>\n\nThe code is void. Tap Link wallet whenever you are ready.", mainMenu(d.appUrl));
  }

  /** Menu buttons navigate in place; deny/verify read the DB and chain before changing anything. */
  async function callback(q: NonNullable<Update["callback_query"]>) {
    const chatId = q.message?.chat.id;
    const p = parseCallback(q.data);
    if (!chatId || !p) return d.tg.answer(q.id, "Unknown action");
    const c: Ctx = { chatId, messageId: q.message?.message_id };
    if (p.kind === "menu") {
      await d.tg.answer(q.id);
      switch (p.action) {
        case "menu": return menu(c);
        case "help": return reply(c, HELP, [backRow()]);
        case "link": return void (await startLink(chatId, c));
        case "cancel": return cancelLink(c);
        case "status": return status(c);
        case "balances": return balances(c);
        case "requests": return requests(c);
      }
    }
    const u = await user(chatId);
    const req = (await d.db.query("SELECT * FROM draw_requests WHERE id = $1", [p.id])).rows[0];
    if (!u || !req || req.borrower !== u.address) return d.tg.answer(q.id, "Not your request");
    if (req.status !== "pending") return d.tg.answer(q.id, `Already ${req.status}`);
    if (p.op === "deny") {
      await d.db.query("UPDATE draw_requests SET status = 'rejected', updated_at = now() WHERE id = $1 AND status = 'pending'", [req.id]);
      await d.tg.answer(q.id, "Denied");
      return reply(c, `✖️ <b>Request #${req.id} denied</b>\n\nThe app has no new budget.`, [navRow("requests")]);
    }
    const g = await governorFor(chatId, u.address, u.governor);
    if (!g) return d.tg.answer(q.id, "No governor on chain");
    const [a, now] = await Promise.all([d.chain.allowance(g, req.app_address as Hex), d.chain.now()]);
    if (a.expiry <= now || a.remaining < BigInt(req.amount)) {
      return d.tg.answer(q.id, "Not on chain yet. Sign the budget in your wallet first.");
    }
    await d.db.query("UPDATE draw_requests SET status = 'approved', updated_at = now() WHERE id = $1 AND status = 'pending'", [req.id]);
    await d.tg.answer(q.id, "Verified on chain");
    return reply(c, `✅ <b>Request #${req.id} approved</b>\n\nOn-chain budget left for this app: <b>${amt(a.remaining)} MUSD</b>.`, [navRow("requests")]);
  }

  async function handle(up: Update) {
    if (up.callback_query) return callback(up.callback_query);
    const msg = up.message;
    if (!msg?.text) return;
    const chatId = msg.chat.id;
    const c: Ctx = { chatId };
    const [cmd, ...args] = msg.text.trim().split(/\s+/);
    switch (cmd.split("@")[0].toLowerCase()) {
      case "/start":
      case "/menu":
        return menu(c);
      case "/help":
        return d.tg.send(chatId, HELP, [backRow()]);
      case "/link":
        return void (await startLink(chatId));
      case "/verify": {
        const code = (await d.db.query<{ code: string }>("SELECT code FROM tg_link_codes WHERE chat_id = $1 AND expires_at > now()", [chatId])).rows[0]?.code;
        if (!code) return d.tg.send(chatId, ...notLinkedCode());
        const r = await completeLink(code, args[0] ?? "", args[1] ?? "", chatId);
        if (!r.ok) return d.tg.send(chatId, r.error === "bad_signature" ? "⚠️ Signature does not match that address." : "⚠️ Usage: <code>/verify 0xAddress 0xSignature</code>", [backRow()]);
        return;
      }
      case "/status":
        return status(c);
      case "/balances":
        return balances(c);
      case "/requests":
        return requests(c);
      case "/revoke":
        return revoke(c);
      case "/unlink":
        await d.db.query("DELETE FROM tg_users WHERE chat_id = $1", [chatId]);
        return d.tg.send(chatId, "✂️ <b>Unlinked</b>\n\nNo data about this chat is kept.", mainMenu(d.appUrl));
      default:
        return d.tg.send(chatId, HELP, mainMenu(d.appUrl));
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
            await d.tg.send(chatId, `🚨 <b>ICR alert</b>\n\nICR ${ratio(s.icr)} is close to your floor ${ratio(s.floor)} (defend ${ratio(s.defend)}). New draws that cross the floor revert on chain. Add collateral or repay to widen the gap.`, [[{ text: "🗺 Open dashboard", url: `${d.appUrl}/app` }, { text: "🛑 Revoke in wallet", url: `${d.appUrl}/app/revoke` }], navRow("status")]);
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

const notLinkedCode = (): [string, Keyboard] => ["⚠️ No active link code. Send /link first.", [backRow()]];
