/** Pure presentation layer for the Telegram bot: texts and inline keyboards. No I/O, fully unit tested. */
import type { Button, Keyboard } from "./api.js";

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const addr = (a: string) => `<code>${short(a)}</code>`;
export const stamp = (d = new Date()) => `<i>Updated ${d.toISOString().slice(11, 16)} UTC</i>`;

/** Callback actions the menu understands. Kept short: Telegram caps callback_data at 64 bytes. */
export const ACTIONS = ["menu", "link", "cancel", "status", "balances", "requests", "help", "radar", "crew"] as const;
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
    [cb("📡 Radar", "radar"), cb("👥 Crew", "crew")],
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
  "📡 /radar [0x…]  redemption radar: price, TCR, frontier, your rank (optional address checks another trove)",
  "👥 /crew  your governor and spend wallets (agents)",
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

/** TroveManager status enum: 0 nonExistent, 1 active, 2 closedByOwner, 3 closedByLiquidation, 4 closedByRedemption. */
export const TROVE_STATUS: Record<number, string> = {
  0: "No trove",
  1: "Active",
  2: "Closed by owner",
  3: "Closed by liquidation",
  4: "Closed by redemption",
};

export interface RadarView {
  price: string;
  tcr: string;
  recoveryMode: boolean;
  troveCount: string;
  frontier: { trove: string; icr: string; debt: string } | null;
  mine: { status: number; icr: string; debt: string; coll: string };
  rank: number;
  debtAhead: string;
  steps: number;
  found: boolean;
  complete: boolean;
  exhausted: boolean;
  /** The trove owner's governor, when one exists: floor/defend lines + defend readiness. */
  gov?: { floor: string; defend: string; standbyLive: boolean; standbyUntil: string | null } | null;
}

/** Text TCR bar against the 1.50 recovery-mode line (scale 0–3.00). */
export const tcrBar = (tcr: string) => {
  const n = Number.parseFloat(tcr);
  const filled = Number.isFinite(n) ? Math.max(0, Math.min(10, Math.round((n / 3) * 10))) : 0;
  return `${"▓".repeat(filled)}${"░".repeat(10 - filled)}`;
};

export const radarText = (r: RadarView, now?: Date) => {
  const rankLine = !r.found && r.exhausted
    ? "Your trove is not in the redemption list."
    : !r.found
      ? `Your trove is deeper than the first ${r.steps} troves from the frontier — at least <b>${r.debtAhead} MUSD</b> of redeemable debt ahead (lower bound, walked ${r.steps}).`
      : r.rank > 0
        ? `🎯 <b>Rank #${r.rank} from redemption</b> · <b>${r.debtAhead} MUSD</b> redeemable debt ahead of you.`
        : "Your trove is below the 1.10 redemption floor, so redemptions skip it.";
  return [
    "📡 <b>Redemption radar</b>",
    `${r.recoveryMode ? "🧊 <b>RECOVERY MODE</b> — redemptions are blocked while TCR is below 1.50" : `🟢 System live · TCR ${r.tcr}`}`,
    `📊 TCR ${tcrBar(r.tcr)} ${r.tcr} (recovery below 1.50)`,
    "",
    `₿ BTC price $${r.price}`,
    `🏦 Troves ${r.troveCount}`,
    ...(r.frontier
      ? [`🌊 Frontier ${addr(r.frontier.trove)} · ICR ${r.frontier.icr} · debt ${r.frontier.debt} MUSD`]
      : ["🌊 Frontier: no troves."]),
    "",
    `⚓ Your trove: ${TROVE_STATUS[r.mine.status] ?? "Unknown"} · ICR ${r.mine.icr}`,
    `💧 Collateral ${r.mine.coll} BTC · debt ${r.mine.debt} MUSD`,
    ...(r.gov
      ? [
          `🛡 Governor floor ${r.gov.floor} · defend ${r.gov.defend} — your trove ICR ${r.mine.icr} vs floor ${r.gov.floor}`,
          r.gov.standbyLive
            ? `🔋 Defend standby live${r.gov.standbyUntil ? ` until ${r.gov.standbyUntil}` : ""} — defend() can repay if you fall below the defend line.`
            : "🔋 Defend standby DISARMED — no live re-arm; re-arm in the app so defend() can repay.",
        ]
      : []),
    rankLine,
    "",
    "Redemptions walk from the lowest ICR upward and skip troves below 1.10.",
    stamp(now),
  ].join("\n");
};

/** agent: "none" or a short monospace address; session: "until YYYY-MM-DD", "expired" or "no agent". */
export interface CrewWalletView { address: string; agent: string; session: string; musd: string }
/** One indexed governor event: Drawn / Defended / Healed, newest first. Amounts are formatted MUSD; ICRs are "x.xx". */
export interface CrewRecent { event: "Drawn" | "Defended" | "Healed"; amount: string; icrBefore?: string; icrAfter?: string; block: string }
export interface CrewView {
  governor: string | null;
  gov: { icr: string; floor: string; defend: string; buffer: string } | null;
  wallets: CrewWalletView[];
  /** Recent draws/defends from the indexer's activity log; [] = none indexed yet. */
  recent?: CrewRecent[];
}

const RECENT_LABEL: Record<CrewRecent["event"], string> = { Drawn: "💸 Drew", Defended: "🛡 Defended", Healed: "🩹 Healed" };

export const crewText = (c: CrewView, now?: Date) => {
  const lines = [
    "👥 <b>Crew</b>",
    ...(c.governor
      ? [
          `⚓ Governor ${addr(c.governor)}`,
          ...(c.gov ? [`📈 ICR ${c.gov.icr} · floor ${c.gov.floor} · defend ${c.gov.defend}`, `💧 Buffer ${c.gov.buffer} MUSD`] : []),
        ]
      : ["No governor yet: create one in the app."]),
    "",
  ];
  if (!c.wallets.length) {
    lines.push("No spend wallets yet. Create one in the app to give an agent a budget.");
  } else {
    lines.push(`💼 <b>${c.wallets.length} spend wallet${c.wallets.length === 1 ? "" : "s"}</b>`);
    for (const w of c.wallets) {
      lines.push(`${addr(w.address)} · agent ${w.agent} · ${w.session} · MUSD ${w.musd}`);
    }
  }
  if (c.governor) {
    lines.push("");
    if (c.recent?.length) {
      lines.push("🕘 <b>Recent draws &amp; defends</b>");
      for (const e of c.recent) {
        const icrs = e.icrBefore !== undefined && e.icrAfter !== undefined
          ? ` · ICR ${e.icrBefore} → ${e.icrAfter}`
          : e.icrAfter !== undefined
            ? ` · ICR after ${e.icrAfter}`
            : "";
        lines.push(`${RECENT_LABEL[e.event]} ${e.amount} MUSD${icrs} · block ${e.block}`);
      }
    } else {
      lines.push("🕘 No draws or defends in the indexed log yet.");
    }
  }
  lines.push("", stamp(now));
  return lines.join("\n");
};

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
  [{ text: "👥 View crew", callback_data: "m:crew" }],
];
