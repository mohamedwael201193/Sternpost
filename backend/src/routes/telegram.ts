import { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";
import type { Bot, Update } from "../telegram/bot.js";
import { linkMessage } from "../telegram/bot.js";
import { logger } from "../logger.js";

export interface TelegramRouteOpts { bot: Bot; webhookSecret: string; cronSecret?: string }

const same = (a: string | undefined, b: string) => !!a && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Telegram webhook, wallet-link signing page and the alert sweep. Mounted only when TELEGRAM_BOT_TOKEN is set. */
export function telegramRoutes(o: TelegramRouteOpts) {
  const r = new Hono();

  r.post("/telegram/webhook", async (c) => {
    if (!same(c.req.header("x-telegram-bot-api-secret-token"), o.webhookSecret)) return c.json({ error: "forbidden" }, 403);
    let up: Update;
    try { up = await c.req.json(); } catch { return c.json({ error: "invalid_json" }, 400); }
    // Always 200 so Telegram does not retry a poisoned update forever.
    await o.bot.handle(up).catch((err) => logger.warn({ err: String(err) }, "telegram update failed"));
    return c.json({ ok: true });
  });

  r.post("/v1/telegram/link", async (c) => {
    let b: { code?: string; address?: string; signature?: string };
    try { b = await c.req.json(); } catch { return c.json({ error: "invalid_json" }, 400); }
    const res = await o.bot.completeLink(String(b.code ?? ""), String(b.address ?? ""), String(b.signature ?? ""));
    if (!res.ok) return c.json({ error: res.error }, res.error === "bad_signature" ? 401 : 400);
    return c.json({ linked: res.address });
  });

  // Vercel Cron sends "Authorization: Bearer $CRON_SECRET".
  const tick = async (c: any) => {
    if (!o.cronSecret || !same(c.req.header("authorization"), `Bearer ${o.cronSecret}`)) return c.json({ error: "forbidden" }, 403);
    return c.json(await o.bot.tick());
  };
  r.get("/v1/telegram/tick", tick);
  r.post("/v1/telegram/tick", tick);

  r.get("/tg/link", (c) => {
    const code = c.req.query("code") ?? "";
    if (!/^[0-9a-f]{16}$/.test(code)) return c.text("Invalid link code. Send /link to the bot again.", 400);
    c.header("content-security-policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'");
    return c.html(linkPage(code));
  });

  return r;
}

const linkPage = (code: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Link Telegram · Sternpost</title><style>
body{font-family:Georgia,serif;background:#f4efe4;color:#151515;display:grid;place-items:center;min-height:100vh;margin:0}
main{max-width:420px;padding:32px;border:1px solid #15151533;background:#fbf8f1}h1{font-weight:400;margin:0 0 12px}
pre{background:#fff;padding:12px;border:1px solid #1515151f;white-space:pre-wrap;font-size:13px}
button{background:#151515;color:#fff;border:0;border-radius:999px;padding:12px 22px;font-size:15px;cursor:pointer}
#s{margin-top:14px;font-size:14px;color:#b0126b}</style></head><body><main>
<h1>Link Telegram</h1><p>Sign this message with your borrower wallet. It is a signature only: no transaction, no gas, no approval.</p>
<pre id="m"></pre><button id="b">Sign &amp; link</button><p id="s"></p></main><script>
const code=${JSON.stringify(code)},msg=${JSON.stringify(linkMessage("CODE"))}.replace("CODE",code);
document.getElementById("m").textContent=msg;const s=document.getElementById("s");
document.getElementById("b").onclick=async()=>{try{if(!window.ethereum){s.textContent="No browser wallet found. Use /verify in Telegram instead.";return}
const [a]=await ethereum.request({method:"eth_requestAccounts"});
const hex="0x"+Array.from(new TextEncoder().encode(msg)).map(x=>x.toString(16).padStart(2,"0")).join("");
const sig=await ethereum.request({method:"personal_sign",params:[hex,a]});
const r=await fetch("/v1/telegram/link",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({code,address:a,signature:sig})});
s.textContent=r.ok?"Linked. Go back to Telegram.":"Link failed: "+((await r.json()).error||r.status)}catch(e){s.textContent=e.message||String(e)}}
</script></body></html>`;
