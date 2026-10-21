/** Minimal Telegram Bot API client. The bot only sends messages; it never holds user keys. */
export type Button = { text: string; url?: string; callback_data?: string };
export type Keyboard = Button[][];

export interface TelegramApi {
  send(chatId: number, text: string, keyboard?: Keyboard): Promise<void>;
  answer(callbackId: string, text?: string): Promise<void>;
}

export function telegramApi(token: string, f: typeof fetch = fetch): TelegramApi {
  const call = async (method: string, body: unknown) => {
    const r = await f(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`telegram_${method}_${r.status}`);
  };
  return {
    send: (chatId, text, keyboard) =>
      call("sendMessage", {
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
      }),
    answer: (callbackId, text) => call("answerCallbackQuery", { callback_query_id: callbackId, text }),
  };
}
