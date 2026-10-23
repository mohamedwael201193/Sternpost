import { describe, it, expect, beforeEach, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { memDb, testApp, json } from "./helpers.js";
import { createBot, linkMessage, type BotDeps } from "../src/telegram/bot.js";
import { telegramApi, type Keyboard } from "../src/telegram/api.js";
import type { ChainReader, GovernorStatus } from "../src/telegram/chain.js";
import type { Db } from "../src/db/pool.js";

const CHAT = 4242;
const GOV = "0x9eea9762ed3c1de2308c800687558064dff0b832";
const APP = "0x1111111111111111111111111111111111111111";
const E18 = 10n ** 18n;
const SECRET = "test_webhook_secret_123";
const CRON = "cron_secret_abcdefghijk";

type Sent = { chat: number; text: string; kb?: Keyboard };
function mocks() {
  const sent: Sent[] = [];
  const answers: { id: string; text?: string }[] = [];
  const st: GovernorStatus = { icr: 3n * E18, floor: (25n * E18) / 10n, defend: (16n * E18) / 10n, frozen: false, buffer: 20n * E18 };
  const allow = { remaining: 0n, perDrawMax: 0n, expiry: 0n };
  const chain: ChainReader & { st: GovernorStatus; allow: typeof allow; gov: string | null } = {
    st, allow, gov: GOV,
    governorOf: vi.fn(async function (this: any) { return chain.gov as any; }),
    status: vi.fn(async () => chain.st),
    allowance: vi.fn(async () => chain.allow),
    balances: vi.fn(async () => ({ musd: 1234n * E18, mezo: 5n * E18 })),
    now: vi.fn(async () => 1_000n),
  };
  return {
    sent, answers, chain,
    tg: { send: vi.fn(async (chat: number, text: string, kb?: Keyboard) => { sent.push({ chat, text, kb }); }), answer: vi.fn(async (id: string, text?: string) => { answers.push({ id, text }); }) },
  };
}

let db: Db, m: ReturnType<typeof mocks>, bot: ReturnType<typeof createBot>;
const msg = (text: string, chat = CHAT) => bot.handle({ message: { chat: { id: chat }, text } });
const cb = (data: string, chat = CHAT) => bot.handle({ callback_query: { id: "cb1", data, message: { chat: { id: chat } } } });
const last = () => m.sent[m.sent.length - 1];
const acct = privateKeyToAccount(generatePrivateKey());
const borrower = acct.address.toLowerCase();

async function link(chat = CHAT) {
  const code = await bot.startLink(chat);
  const signature = await acct.signMessage({ message: linkMessage(code) });
  return bot.completeLink(code, acct.address, signature);
}
async function addRequest(amount = 5n * E18, reason: string | null = "api credits") {
  await db.query("INSERT INTO apps (name, address) VALUES ('Desk', $1) ON CONFLICT DO NOTHING", [APP]);
  return (await db.query("INSERT INTO draw_requests (app_address, borrower, amount, reason) VALUES ($1,$2,$3,$4) RETURNING *", [APP, borrower, String(amount), reason])).rows[0];
}

beforeEach(async () => {
  db = await memDb();
  m = mocks();
  const deps: BotDeps = { db, tg: m.tg, chain: m.chain, appUrl: "https://app.test", apiUrl: "https://api.test" };
  bot = createBot(deps);
});

describe("telegram commands", () => {
  it("/start and unknown text show help", async () => {
    await msg("/start");
    expect(last().text).toContain("/link");
    await msg("hello");
    expect(last().text).toContain("never holds keys");
    await msg("/help@SternpostBot");
    expect(m.sent).toHaveLength(3);
  });
  it("ignores updates without text", async () => {
    await bot.handle({ message: { chat: { id: CHAT } } });
    await bot.handle({});
    expect(m.sent).toHaveLength(0);
  });
  it("commands that need a wallet ask to /link first", async () => {
    for (const c of ["/status", "/balances", "/requests", "/revoke"]) await msg(c);
    expect(m.sent.every((s) => s.text.includes("/link"))).toBe(true);
  });
});

describe("wallet linking", () => {
  it("/link issues a code with a signing-page button", async () => {
    await msg("/link");
    const code = /Code: ([0-9a-f]{16})/.exec(last().text)![1];
    expect(last().kb![0][0].url).toBe(`https://api.test/tg/link?code=${code}`);
  });
  it("binds the signer to the chat that asked, and resolves the governor", async () => {
    const r = await link();
    expect(r).toMatchObject({ ok: true, address: borrower, chatId: CHAT });
    const u = (await db.query("SELECT * FROM tg_users WHERE chat_id = $1", [CHAT])).rows[0];
    expect(u.address).toBe(borrower);
    expect(u.governor).toBe(GOV);
    expect(last().text).toContain("Linked");
  });
  it("rejects a signature from another key, and reused or bogus codes", async () => {
    const code = await bot.startLink(CHAT);
    const other = privateKeyToAccount(generatePrivateKey());
    const sig = await other.signMessage({ message: linkMessage(code) });
    expect(await bot.completeLink(code, acct.address, sig)).toEqual({ ok: false, error: "bad_signature" });
    const good = await acct.signMessage({ message: linkMessage(code) });
    expect((await bot.completeLink(code, acct.address, good)).ok).toBe(true);
    expect(await bot.completeLink(code, acct.address, good)).toEqual({ ok: false, error: "code_expired" });
    expect(await bot.completeLink("zz", acct.address, good)).toEqual({ ok: false, error: "validation_error" });
  });
  it("expired codes are refused", async () => {
    const code = await bot.startLink(CHAT);
    await db.query("UPDATE tg_link_codes SET expires_at = now() - interval '1 second'");
    const sig = await acct.signMessage({ message: linkMessage(code) });
    expect(await bot.completeLink(code, acct.address, sig)).toEqual({ ok: false, error: "code_expired" });
  });
  it("/verify links manually and reports bad input", async () => {
    await msg("/verify 0x1 0x2");
    expect(last().text).toContain("/link first");
    const code = await bot.startLink(CHAT);
    await msg("/verify nope");
    expect(last().text).toContain("Usage");
    const other = privateKeyToAccount(generatePrivateKey());
    await msg(`/verify ${acct.address} ${await other.signMessage({ message: linkMessage(code) })}`);
    expect(last().text).toContain("does not match");
    await msg(`/verify ${acct.address} ${await acct.signMessage({ message: linkMessage(code) })}`);
    expect(last().text).toContain("Linked");
  });
  it("a code from one chat cannot be redeemed through another chat's /verify", async () => {
    const code = await bot.startLink(CHAT);
    const sig = await acct.signMessage({ message: linkMessage(code) });
    expect(await bot.completeLink(code, acct.address, sig, 999)).toEqual({ ok: false, error: "code_expired" });
  });
  it("links without a governor and /unlink forgets the chat", async () => {
    m.chain.gov = null;
    await link();
    expect(last().text).toContain("No governor yet");
    await msg("/status");
    expect(last().text).toContain("no Sternpost governor");
    await msg("/unlink");
    expect((await db.query("SELECT * FROM tg_users")).rows).toHaveLength(0);
  });
});

describe("status, balances, revoke", () => {
  beforeEach(async () => { await link(); });
  it("/status shows live ICR, floor, defend and buffer", async () => {
    await msg("/status");
    expect(last().text).toContain("Healthy");
    expect(last().text).toContain("ICR 3.00");
    expect(last().text).toContain("floor 2.50");
    expect(last().text).toContain("defend 1.60");
    expect(last().text).toContain("Buffer 20 MUSD");
  });
  it("/status flags near-floor and frozen", async () => {
    m.chain.st.icr = (26n * E18) / 10n;
    await msg("/status");
    expect(last().text).toContain("Near floor");
    m.chain.st.frozen = true;
    await msg("/status");
    expect(last().text).toContain("FROZEN");
  });
  it("/balances shows MUSD and MEZO", async () => {
    await msg("/balances");
    expect(last().text).toContain("MUSD 1,234");
    expect(last().text).toContain("MEZO 5");
  });
  it("/revoke deep-links to the app; the bot never signs", async () => {
    await msg("/revoke");
    expect(last().kb![0][0]).toEqual({ text: "Revoke in wallet", url: "https://app.test/app/revoke" });
  });
});

describe("draw request approvals", () => {
  beforeEach(async () => { await link(); });
  it("/requests lists pending requests with approve/verify/deny buttons", async () => {
    await msg("/requests");
    expect(last().text).toContain("No pending requests.");
    const r = await addRequest(5n * E18, "<b>x</b>");
    await msg("/requests");
    expect(last().text).toContain("5 MUSD");
    expect(last().text).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(last().kb![0][0].url).toBe(`https://app.test/app/apps?app=${APP}&amount=${5n * E18}&request=${r.id}`);
    expect(last().kb![1].map((b) => b.callback_data)).toEqual([`verify:${r.id}`, `deny:${r.id}`]);
  });
  it("deny rejects only the owner's pending request", async () => {
    const r = await addRequest();
    await cb(`deny:${r.id}`, 777);
    expect(m.answers.at(-1)!.text).toBe("Not your request");
    await cb(`deny:${r.id}`);
    expect((await db.query("SELECT status FROM draw_requests WHERE id = $1", [r.id])).rows[0].status).toBe("rejected");
    await cb(`deny:${r.id}`);
    expect(m.answers.at(-1)!.text).toBe("Already rejected");
  });
  it("verify refuses until the on-chain budget covers the request", async () => {
    const r = await addRequest(5n * E18);
    await cb(`verify:${r.id}`);
    expect(m.answers.at(-1)!.text).toContain("Not on chain yet");
    m.chain.allow.remaining = 10n * E18;
    m.chain.allow.expiry = 500n; // expired relative to chain time 1000
    await cb(`verify:${r.id}`);
    expect(m.answers.at(-1)!.text).toContain("Not on chain yet");
    expect((await db.query("SELECT status FROM draw_requests WHERE id = $1", [r.id])).rows[0].status).toBe("pending");
    m.chain.allow.expiry = 5_000n;
    await cb(`verify:${r.id}`);
    expect(m.answers.at(-1)!.text).toBe("Verified on chain");
    expect((await db.query("SELECT status FROM draw_requests WHERE id = $1", [r.id])).rows[0].status).toBe("approved");
    expect(m.chain.allowance).toHaveBeenCalledWith(GOV, APP);
  });
  it("rejects malformed callbacks and verify without a governor", async () => {
    await cb("hack:1");
    expect(m.answers.at(-1)!.text).toBe("Unknown action");
    await bot.handle({ callback_query: { id: "x", data: "deny:1" } });
    expect(m.answers.at(-1)!.text).toBe("Unknown action");
    const r = await addRequest();
    await db.query("UPDATE tg_users SET governor = NULL");
    m.chain.gov = null;
    await cb(`verify:${r.id}`);
    expect(m.answers.at(-1)!.text).toBe("No governor on chain");
  });
  it("notifyRequest pushes to every chat linked to the borrower", async () => {
    await link(5151);
    const r = await addRequest();
    m.sent.length = 0;
    await bot.notifyRequest(r);
    expect(m.sent.map((s) => s.chat).sort()).toEqual([CHAT, 5151]);
  });
});

describe("tick sweep", () => {
  beforeEach(async () => { await link(); m.sent.length = 0; });
  it("alerts once per hour when ICR nears the floor, re-arms after recovery", async () => {
    m.chain.st.icr = (26n * E18) / 10n;
    expect(await bot.tick()).toMatchObject({ users: 1, alerts: 1 });
    expect(last().text).toContain("ICR alert");
    expect((await bot.tick()).alerts).toBe(0);
    m.chain.st.icr = 4n * E18;
    await bot.tick();
    expect((await db.query("SELECT alerted_at FROM tg_users")).rows[0].alerted_at).toBeNull();
    m.chain.st.icr = (26n * E18) / 10n;
    expect((await bot.tick()).alerts).toBe(1);
  });
  it("pushes requests created after linking exactly once", async () => {
    await addRequest();
    expect((await bot.tick()).pushed).toBe(1);
    expect((await bot.tick()).pushed).toBe(0);
  });
  it("survives an RPC failure for one chat", async () => {
    (m.chain.status as any).mockRejectedValueOnce(new Error("rpc down"));
    await expect(bot.tick()).resolves.toMatchObject({ users: 1, alerts: 0 });
  });
});

describe("telegram routes", () => {
  async function routed() {
    const { app, db: d } = await testApp({ db });
    void app;
    return (await testApp({ db: d, telegram: { bot, webhookSecret: SECRET, cronSecret: CRON } })).app;
  }
  it("webhook requires the secret header and handles updates", async () => {
    const app = await routed();
    const body = { message: { chat: { id: CHAT }, text: "/start" } };
    expect((await app.request("/telegram/webhook", json(body))).status).toBe(403);
    const ok = await app.request("/telegram/webhook", { ...json(body), headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": SECRET } });
    expect(ok.status).toBe(200);
    expect(last().text).toContain("/link");
    const bad = await app.request("/telegram/webhook", { method: "POST", body: "{", headers: { "x-telegram-bot-api-secret-token": SECRET } });
    expect(bad.status).toBe(400);
  });
  it("webhook returns 200 even when a handler throws", async () => {
    const app = await routed();
    m.tg.send.mockRejectedValueOnce(new Error("tg down"));
    const r = await app.request("/telegram/webhook", { ...json({ message: { chat: { id: 1 }, text: "/start" } }), headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": SECRET } });
    expect(r.status).toBe(200);
  });
  it("POST /v1/telegram/link verifies the signature", async () => {
    const app = await routed();
    const code = await bot.startLink(CHAT);
    const other = privateKeyToAccount(generatePrivateKey());
    expect((await app.request("/v1/telegram/link", json({ code, address: acct.address, signature: await other.signMessage({ message: linkMessage(code) }) }))).status).toBe(401);
    expect((await app.request("/v1/telegram/link", json({ code: "x" }))).status).toBe(400);
    expect((await app.request("/v1/telegram/link", { method: "POST", body: "{" })).status).toBe(400);
    const r = await app.request("/v1/telegram/link", json({ code, address: acct.address, signature: await acct.signMessage({ message: linkMessage(code) }) }));
    expect(await r.json()).toEqual({ linked: borrower });
  });
  it("tick requires the cron bearer secret", async () => {
    const app = await routed();
    expect((await app.request("/v1/telegram/tick")).status).toBe(403);
    const r = await app.request("/v1/telegram/tick", { headers: { authorization: `Bearer ${CRON}` } });
    expect(await r.json()).toEqual({ users: 0, alerts: 0, pushed: 0 });
  });
  it("serves the signing page only for well-formed codes", async () => {
    const app = await routed();
    expect((await app.request("/tg/link?code=bad")).status).toBe(400);
    const r = await app.request("/tg/link?code=0123456789abcdef");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-security-policy")).toContain("connect-src 'self'");
    const html = await r.text();
    expect(html).toContain("0123456789abcdef");
    expect(html).toContain("personal_sign");
  });
  it("POST /v1/requests pushes to linked chats and survives a failed push", async () => {
    const app = await routed();
    await link();
    await app.request("/v1/apps", json({ name: "Desk", address: APP }));
    m.sent.length = 0;
    const r = await app.request("/v1/requests", json({ appAddress: APP, borrower, amount: String(E18) }));
    expect(r.status).toBe(201);
    expect(last().text).toContain("Draw request");
    m.tg.send.mockRejectedValueOnce(new Error("down"));
    expect((await app.request("/v1/requests", json({ appAddress: APP, borrower, amount: String(E18) }))).status).toBe(201);
  });
  it("routes are absent when the bot is not configured", async () => {
    const { app } = await testApp({ db });
    expect((await app.request("/telegram/webhook", json({}))).status).toBe(404);
  });
});

describe("telegram api client", () => {
  it("posts sendMessage with inline keyboard and answerCallbackQuery", async () => {
    const calls: { url: string; body: any }[] = [];
    const f = (async (url: string, init: any) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response("{}"); }) as any;
    const api = telegramApi("TOKEN", f);
    await api.send(1, "hi", [[{ text: "a", url: "https://x" }]]);
    await api.send(1, "plain");
    await api.answer("q", "ok");
    expect(calls[0].url).toBe("https://api.telegram.org/botTOKEN/sendMessage");
    expect(calls[0].body.reply_markup.inline_keyboard[0][0].text).toBe("a");
    expect(calls[1].body.reply_markup).toBeUndefined();
    expect(calls[2].body).toEqual({ callback_query_id: "q", text: "ok" });
  });
  it("throws on a non-2xx response", async () => {
    const api = telegramApi("T", (async () => new Response("", { status: 429 })) as any);
    await expect(api.send(1, "x")).rejects.toThrow("telegram_sendMessage_429");
  });
});
