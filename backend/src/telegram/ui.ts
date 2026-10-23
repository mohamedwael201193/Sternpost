/** Pure presentation layer for the Telegram bot: texts and inline keyboards. No I/O, fully unit tested. */
import type { Button, Keyboard } from "./api.js";

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const addr = (a: string) => `<code>${short(a)}</code>`;
export const stamp = (d = new Date()) => `<i>Updated ${d.toISOString().slice(11, 16)} UTC</i>`;

/** Callback actions the menu understands. Kept short: Telegram caps callback_data at 64 bytes. */
export const ACTIONS = ["menu", "link", "cancel", "status", "balances", "requests", "help"] as const;
export type Action = (typeof ACTIONS)[number];
export const cbData = (a: Action) => `m:${a}`;
export function parseCallback(data: string | undefined):
  | { kind: "menu"; action: Action }
  | { kind: "request"; op: "deny" | "verify"; id: number }
  | null {
  const m = /^m:([a-z]+)$/.exec(data ?? "");
  if (m && (ACTIONS as readonly string[]).includes(m[1])) return { kind: "menu", action: m[1] as Action };
  const r = /^(deny|verify):(\d{1,12})$/.exec(data ?? "");
  return r ? { kind: "request", op: r[1] as "deny" | "verify", id: Number(r[2]) } : null;
}

const cb = (text: string, a: Action): Button => ({ text, callback_data: cbData(a) });
export const backRow = (): Button[] => [cb("⬅️ Menu", "menu")];
export const navRow = (refresh: Action): Button[] => [cb("🔄 Refresh", refresh), ...backRow()];

export function mainMenu(appUrl: string): Keyboard {
  return [
    [cb("🔗 Link wallet", "link"), cb("🧭 Status", "status")],
    [cb("🪙 Balances", "balances"), cb("📜 Requests", "requests")],
    [{ text: "🗺 Open dashboard", url: `${appUrl}/app` }, { text: "🛑 Revoke", url: `${appUrl}/app/revoke` }],
    [cb("🛟 Help", "help")],
  ];
}

export const WELCOME = [
  "⚓ <b>Sternpost</b>",
  "<i>Your Mezo trove's chartroom.</i>",
  "",
  "I watch your trove health and your agents' MUSD draw requests, and ping you before anything gets close to the floor.",
  "",
  "Start with 🔗 <b>Link wallet</b> (or /link). You sign one message, no transaction, no gas.",
  "",
  "🔐 The bot never holds keys. Every approval and revoke is signed by you and enforced on chain.",
].join("\n");

export const HELP = [
  "🛟 <b>Help</b>",
  "",
  "🔗 /link  connect your wallet (one signature)",
  "🧭 /status  ICR, floor, defend line, buffer",
  "🪙 /balances  MUSD and MEZO in your wallet",
  "📜 /requests  pending agent draw requests",
  "🛑 /revoke  freeze every draw from the app",
  "✂️ /unlink  disconnect this chat",
  "",
  "🔐 The bot never holds keys. Every approval and revoke is signed by you in your wallet and enforced on chain.",
].join("\n");

export const notLinked = (): [string, Keyboard] => [
  "🔗 <b>No wallet linked yet</b>\n\nTap <b>Link wallet</b> or send /link first. It takes one signature.",
  [[cb("🔗 Link wallet", "link")], backRow()],
];

export const linkPrompt = (message: string, minutes: number, signUrl: string): [string, Keyboard] => [
  [
    "🔗 <b>Link your wallet</b>",
    "",
    `Sign this message with your borrower wallet (valid ${minutes} min):`,
    `<code>${esc(message)}</code>`,
    "",
    "Tap <b>Sign in wallet</b>, or sign it anywhere and send:",
    "<code>/verify 0xYourAddress 0xSignature</code>",
  ].join("\n"),
  [[{ text: "✍️ Sign in wallet", url: signUrl }], [cb("✖️ Cancel", "cancel")]],
];

export const linked = (a: string, g: string | null): string =>
  `✅ <b>Linked</b> ${addr(a)}\n\n${g ? `⚓ Governor ${addr(g)}` : "No governor yet: create one in the app."}\n\nTry 🧭 <b>Status</b> or /status.`;

export type Health = "frozen" | "near" | "healthy";
export const healthLabel: Record<Health, string> = { frozen: "🧊 <b>FROZEN</b>", near: "🟠 <b>Near floor</b>", healthy: "🟢 <b>Healthy</b>" };

export const statusText = (h: Health, gov: string, r: { icr: string; floor: string; defend: string; buffer: string }, now?: Date) =>
  [
    "🧭 <b>Trove status</b>",
    `${healthLabel[h]}  ·  governor ${addr(gov)}`,
    "",
    `📈 ICR ${r.icr}`,
    `🚧 floor ${r.floor}  ·  🛡 defend ${r.defend}`,
    `💧 Buffer ${r.buffer} MUSD`,
    "",
    stamp(now),
  ].join("\n");

export const balancesText = (a: string, musd: string, mezo: string, now?: Date) =>
  ["🪙 <b>Balances</b>", `Wallet ${addr(a)}`, "", `💵 MUSD ${musd}`, `⛓ MEZO ${mezo}`, "", stamp(now)].join("\n");

export const requestText = (r: { id: number; app_address: string; amountFmt: string; reason?: string | null }) =>
  [
    `📜 <b>Draw request #${r.id}</b>`,
    `App ${addr(r.app_address)} asks <b>${r.amountFmt} MUSD</b>`,
    ...(r.reason ? [`Reason: ${esc(r.reason)}`] : []),
    "",
    "<i>Approve signs an on-chain budget for this app in your wallet. Nothing moves until that transaction lands.</i>",
  ].join("\n");

export const requestKeyboard = (appUrl: string, r: { id: number; app_address: string; amount: string }): Keyboard => [
  [
    { text: "✅ Approve in wallet", url: `${appUrl}/app/apps?app=${r.app_address}&amount=${r.amount}&request=${r.id}` },
    { text: "🔎 View in app", url: `${appUrl}/app/apps?request=${r.id}` },
  ],
  [{ text: "🔁 I signed, verify", callback_data: `verify:${r.id}` }, { text: "✖️ Deny", callback_data: `deny:${r.id}` }],
];
