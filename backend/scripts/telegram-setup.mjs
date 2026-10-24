// Registers the webhook and command menu. Usage:
//   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... node scripts/telegram-setup.mjs [https://sternpost-api.vercel.app]
const token = process.env.TELEGRAM_BOT_TOKEN, secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const base = process.argv[2] ?? process.env.PUBLIC_API_URL ?? "https://sternpost-api.vercel.app";
if (!token || !secret) { console.error("TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET are required"); process.exit(1); }
const call = async (method, body) => {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  console.log(method, j.ok ? "ok" : j.description);
  if (!j.ok) process.exit(1);
};
await call("setWebhook", { url: `${base}/telegram/webhook`, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
await call("setMyCommands", { commands: [
  { command: "start", description: "Main menu" },
  { command: "link", description: "Connect your wallet" },
  { command: "status", description: "Trove health" },
  { command: "balances", description: "MUSD and MEZO" },
  { command: "requests", description: "Pending draw requests" },
  { command: "revoke", description: "Freeze all draws" },
  { command: "unlink", description: "Disconnect this chat" },
  { command: "help", description: "How it works" },
] });
await call("setMyShortDescription", { short_description: "⚓ Watch your Mezo trove and approve agent MUSD draws. Never holds keys." });
await call("setMyDescription", { description: "⚓ Sternpost is your Mezo trove's chartroom.\n\n🧭 Live ICR, floor and buffer\n🚨 Alerts before you near the floor\n📜 Approve or deny agent MUSD draw requests\n\n🔐 Never holds keys: every approval and revoke is signed in your wallet and enforced on chain." });
