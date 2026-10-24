import { describe, it, expect, vi } from "vitest";
import { memDb } from "./helpers.js";
import { createBot } from "../src/telegram/bot.js";
import { telegramApi, notModified } from "../src/telegram/api.js";
import { ACTIONS, cbData, esc, mainMenu, navRow, parseCallback, statusText, balancesText, requestKeyboard, linkPrompt, notLinked } from "../src/telegram/ui.js";

const APP = "https://app.test";

describe("telegram ui", () => {
  it("main menu grid has every entry, url buttons for dashboard and revoke", () => {
    const kb = mainMenu(APP);
    const flat = kb.flat();
    expect(flat.map((b) => b.text)).toEqual(["🔗 Link wallet", "🧭 Status", "🪙 Balances", "📜 Requests", "🗺 Open dashboard", "🛑 Revoke", "🛟 Help"]);
    expect(flat.find((b) => b.text.includes("dashboard"))!.url).toBe(`${APP}/app`);
    expect(flat.find((b) => b.text.includes("Revoke"))!.url).toBe(`${APP}/app/revoke`);
    expect(kb.every((row) => row.length <= 2)).toBe(true);
    for (const b of flat) expect(!!b.url !== !!b.callback_data).toBe(true);
  });
  it("callback data round-trips and stays under Telegram's 64-byte cap", () => {
    for (const a of ACTIONS) {
      expect(parseCallback(cbData(a))).toEqual({ kind: "menu", action: a });
      expect(Buffer.byteLength(cbData(a))).toBeLessThanOrEqual(64);
    }
    expect(parseCallback("verify:12")).toEqual({ kind: "request", op: "verify", id: 12 });
    expect(parseCallback("deny:3")).toEqual({ kind: "request", op: "deny", id: 3 });
    for (const bad of [undefined, "", "m:drop", "m:", "approve:1", "deny:x", "deny:1234567890123"]) expect(parseCallback(bad)).toBeNull();
  });
  it("nav rows: Refresh re-runs the same view, Menu goes home", () => {
    expect(navRow("status").map((b) => b.callback_data)).toEqual(["m:status", "m:menu"]);
  });
  it("formats: monospace only for addresses, HTML escaped, timestamp present", () => {
    const at = new Date("2026-10-23T15:40:00Z");
    const s = statusText("near", "0x9eea9762ed3c1de2308c800687558064dff0b832", { icr: "2.60", floor: "2.50", defend: "1.60", buffer: "1,234.5" }, at);
    expect(s).toContain("<code>0x9eea…b832</code>");
    expect(s).toContain("Near floor");
    expect(s).toContain("Buffer 1,234.5 MUSD");
    expect(s).toContain("Updated 15:40 UTC");
    expect(s.match(/<code>/g)).toHaveLength(1);
    expect(balancesText("0x1111111111111111111111111111111111111111", "1,000", "2", at)).toContain("MUSD 1,000");
    expect(esc("<a&b>")).toBe("&lt;a&amp;b&gt;");
  });
  it("request, link and unlinked keyboards", () => {
    const kb = requestKeyboard(APP, { id: 7, app_address: "0xab", amount: "5" });
    expect(kb[0][1]).toEqual({ text: "🔎 View in app", url: `${APP}/app/apps?request=7` });
    const [, lk] = linkPrompt("msg", 10, "https://api.test/tg/link?code=c");
    expect(lk.map((r) => r[0].url ?? r[0].callback_data)).toEqual(["https://api.test/tg/link?code=c", "m:cancel"]);
    expect(notLinked()[1][0][0].callback_data).toBe("m:link");
  });
});

describe("telegram callbacks edit in place", () => {
  async function setup(editImpl?: (...a: any[]) => Promise<void>) {
    const db = await memDb();
    const tg = { send: vi.fn(async () => {}), answer: vi.fn(async () => {}), edit: vi.fn(editImpl ?? (async () => {})) };
    const chain = { governorOf: vi.fn(async () => null), status: vi.fn(), allowance: vi.fn(), balances: vi.fn(), now: vi.fn() } as any;
    const bot = createBot({ db, tg, chain, appUrl: APP, apiUrl: "https://api.test" });
    const press = (data: string) => bot.handle({ callback_query: { id: "q", data, message: { chat: { id: 9 }, message_id: 55 } } });
    return { db, tg, bot, press };
  }
  it("menu buttons answer the query and edit the same message", async () => {
    const { tg, press } = await setup();
    await press("m:help");
    expect(tg.answer).toHaveBeenCalledWith("q");
    expect(tg.edit).toHaveBeenCalledWith(9, 55, expect.stringContaining("Help"), [[{ text: "⬅️ Menu", callback_data: "m:menu" }]]);
    expect(tg.send).not.toHaveBeenCalled();
  });
  it("unlinked users pressing data buttons get a Link prompt", async () => {
    const { tg, press } = await setup();
    for (const a of ["m:status", "m:balances", "m:requests"]) await press(a);
    for (const call of tg.edit.mock.calls) {
      expect(call[2]).toContain("No wallet linked");
      expect((call[3] as any)[0][0].callback_data).toBe("m:link");
    }
  });
  it("link from the menu edits into the sign prompt; cancel voids the code", async () => {
    const { db, tg, press } = await setup();
    await press("m:link");
    expect(tg.edit.mock.calls[0][2]).toContain("Link your wallet");
    expect((await db.query("SELECT count(*)::int AS n FROM tg_link_codes")).rows[0].n).toBe(1);
    await press("m:cancel");
    expect((await db.query("SELECT count(*)::int AS n FROM tg_link_codes")).rows[0].n).toBe(0);
    expect(tg.edit.mock.calls[1][2]).toContain("Link cancelled");
  });
  it("a no-op edit is swallowed; other edit failures fall back to a new message", async () => {
    const a = await setup(async () => { throw new Error("telegram_editMessageText_400: Bad Request: message is not modified"); });
    await a.press("m:menu");
    expect(a.tg.send).not.toHaveBeenCalled();
    const b = await setup(async () => { throw new Error("telegram_editMessageText_400: message to edit not found"); });
    await b.press("m:menu");
    expect(b.tg.send).toHaveBeenCalledTimes(1);
  });
  it("/start sends the welcome with the main menu", async () => {
    const { tg, bot } = await setup();
    await bot.handle({ message: { chat: { id: 9 }, text: "/start" } });
    expect(tg.send).toHaveBeenCalledWith(9, expect.stringContaining("Sternpost"), mainMenu(APP));
  });
});

describe("telegram api client", () => {
  it("editMessageText payload and error description surface", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: false, description: "Bad Request: message is not modified" }), { status: 400 }));
    const api = telegramApi("T", f as any);
    const err = await api.edit!(1, 2, "x", [[{ text: "a", callback_data: "m:menu" }]]).catch((e) => e);
    expect(notModified(err)).toBe(true);
    const body = JSON.parse((f.mock.calls[0] as any)[1].body);
    expect(body).toMatchObject({ chat_id: 1, message_id: 2, parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "a", callback_data: "m:menu" }]] } });
    expect((f.mock.calls[0] as any)[0]).toContain("/editMessageText");
  });
});
