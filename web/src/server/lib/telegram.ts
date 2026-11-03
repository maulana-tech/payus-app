import "server-only";
import { getServerEnv } from "../../env.server";

// The Telegram bot, as thin as it can be: four calls, no SDK. Everything
// here degrades to "off" without a token, because a deployment without a
// bot should behave as though the feature does not exist rather than throw
// where money is being decided.

const API = "https://api.telegram.org";

export const telegramConfigured = () =>
  Boolean(getServerEnv().TELEGRAM_BOT_TOKEN);

/** The secret Telegram echoes back on every delivery, when one is set. */
export const telegramSecret = () => getServerEnv().TELEGRAM_WEBHOOK_SECRET;

async function call<T>(method: string, body: unknown): Promise<T | null> {
  const token = getServerEnv().TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  const response = await fetch(`${API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(`Telegram ${method} failed: ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : null) as T;
}

export type Button = { text: string; data: string };

/** Telegram's own escaping for the one parse mode we use. */
export const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function sendMessage(
  chatId: string,
  html: string,
  buttons: Button[][] = [],
): Promise<{ messageId: number } | null> {
  const result = await call<{ result?: { message_id?: number } }>(
    "sendMessage",
    {
      chat_id: chatId,
      text: html,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(buttons.length > 0
        ? {
            reply_markup: {
              inline_keyboard: buttons.map((row) =>
                row.map((button) => ({
                  text: button.text,
                  callback_data: button.data,
                })),
              ),
            },
          }
        : {}),
    },
  );
  const messageId = result?.result?.message_id;
  return messageId ? { messageId } : null;
}

/** Replaces a message's text and takes its buttons away. */
export async function editMessage(
  chatId: string,
  messageId: number,
  html: string,
): Promise<void> {
  await call("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: html,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [] },
  });
}

/** Stops the button spinning. Telegram expects this within seconds. */
export async function answerCallback(
  callbackId: string,
  text?: string,
): Promise<void> {
  await call("answerCallbackQuery", {
    callback_query_id: callbackId,
    ...(text ? { text, show_alert: false } : {}),
  });
}
