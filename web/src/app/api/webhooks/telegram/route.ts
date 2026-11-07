import {
  answerCallback,
  editMessage,
  escapeHtml,
  sendMessage,
  telegramConfigured,
  telegramSecret,
} from "@/server/lib/telegram";
import { runAdvisor } from "@/server/modules/agents/advisor.agent";
import {
  latestChatId,
  recordAdvisorTurn,
} from "@/server/modules/agents/history.service";
import { runReporter } from "@/server/modules/agents/reporter.agent";
import {
  approveProposal,
  refuseProposal,
  waiting,
} from "@/server/modules/guardian/guardian.service";
import {
  claimCode,
  ownerForChat,
  proposalMessage,
  unlinkTelegram,
} from "@/server/modules/notifications/telegram.service";

// Telegram's updates. Two things can arrive: a chat proving itself with a
// code, and a decision on a proposal.
//
// What makes this safe is what it does *not* trust. The secret header says
// the delivery is Telegram's. The chat id comes from that body and is only
// ever used to look up which account this chat may act for — the callback
// data carries a proposal id and nothing else, and every decision goes
// through the same guardian functions the dashboard's buttons use, so the
// hash check, the expiry and the audit trail are identical either way.
export const dynamic = "force-dynamic";

type Update = {
  message?: {
    chat?: { id?: number };
    text?: string;
  };
  callback_query?: {
    id?: string;
    data?: string;
    message?: { chat?: { id?: number }; message_id?: number };
  };
};

const ok = () => Response.json({ ok: true });

export async function POST(request: Request) {
  if (!telegramConfigured())
    return Response.json({ error: "telegram_not_configured" }, { status: 503 });

  const secret = telegramSecret();
  if (
    secret &&
    request.headers.get("x-telegram-bot-api-secret-token") !== secret
  )
    return Response.json({ error: "bad_secret" }, { status: 401 });

  let update: Update;
  try {
    update = (await request.json()) as Update;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  // Telegram retries anything that is not a 2xx, and a retry of a decision
  // is not something we want — so the answer is 200 whether this was
  // handled, ignored, or failed outright.
  //
  // Failing to *speak back* is the realistic case: a chat that blocked the
  // bot, a message too old to edit, a rate limit. `call()` throws on all of
  // them, and by then the decision has already been recorded — a retry
  // would record a second act of consent for one press of one button.
  try {
    if (update.message) await onMessage(update.message);
    else if (update.callback_query) await onCallback(update.callback_query);
  } catch (error) {
    console.error(
      "[telegram] update handled but the reply failed:",
      error instanceof Error ? error.message : error,
    );
  }
  return ok();
}

/**
 * What the bot can do, in the order someone needs it. Kept here rather than
 * only in BotFather's menu: a person who types /help is usually stuck, and
 * the answer should not depend on a menu they did not notice.
 */
const COMMANDS = [
  ["/status", "What is waiting for you right now"],
  ["/ask <question>", "Ask the Advisor, from your own rows"],
  ["/today", "The Reporter's few sentences on the day"],
  ["/help", "This list"],
  ["/unlink", "Stop sending approvals to this chat"],
] as const;

/** A table of rows, narrow enough for a phone-width chat window. */
function rowsAsText(rows: Record<string, string>[], limit = 8): string {
  if (rows.length === 0) return "(no rows)";
  const shown = rows.slice(0, limit);
  const lines = shown.map((row) =>
    Object.entries(row)
      .map(([key, value]) => `${key.replaceAll("_", " ")}: ${value}`)
      .join(" · "),
  );
  if (rows.length > shown.length)
    lines.push(`…and ${rows.length - shown.length} more`);
  return lines.map((line) => escapeHtml(line)).join("\n");
}

const helpText = (linked: string | null) =>
  [
    linked
      ? `This chat decides for <b>@${escapeHtml(linked)}</b>.`
      : "This chat is not linked to a Payus account yet.",
    "",
    ...COMMANDS.map(([name, what]) => `<code>${name}</code> — ${what}`),
    "",
    linked
      ? "When the Guardian holds something, it arrives here with Approve and Refuse on it. The buttons do exactly what the ones in the dashboard do."
      : "Open Payus → Settings → Approvals on Telegram, press <i>Link a chat</i>, and send me the code it gives you.",
  ].join("\n");

async function onMessage(message: NonNullable<Update["message"]>) {
  const chatId = message.chat?.id;
  if (!chatId) return;
  const chat = String(chatId);
  const text = (message.text ?? "").trim();
  // Telegram appends @thebot in groups; strip it so commands work there too.
  const command = text.split(/\s+/)[0]?.split("@")[0]?.toLowerCase() ?? "";

  if (command === "/start") {
    const code = text.match(/^\/start\s+(\S+)$/)?.[1];
    if (!code) {
      await sendMessage(chat, helpText(await ownerForChat(chat)));
      return;
    }
    const owner = await claimCode(code, chat);
    await sendMessage(
      chat,
      owner
        ? `Linked to <b>@${escapeHtml(owner)}</b>. Anything the Guardian holds will arrive here, with the buttons to decide it.\n\nTry <code>/status</code>.`
        : "That code is not one of ours, or it has been used already. Open Payus → Settings for a fresh one.",
    );
    return;
  }

  if (command === "/help") {
    await sendMessage(chat, helpText(await ownerForChat(chat)));
    return;
  }

  // Everything below acts for an account, so it needs one. The chat id is
  // never authority on its own — it is only ever looked up.
  const owner = await ownerForChat(chat);

  if (command === "/unlink") {
    if (!owner) {
      await sendMessage(chat, "This chat is not linked to anything.");
      return;
    }
    await unlinkTelegram(owner);
    await sendMessage(
      chat,
      `Unlinked from <b>@${escapeHtml(owner)}</b>. Nothing will arrive here now, and the dashboard still has everything. Settings will give you a fresh code whenever you want it back.`,
    );
    return;
  }

  if (command === "/status") {
    if (!owner) {
      await sendMessage(chat, helpText(null));
      return;
    }
    const pending = await waiting(owner);
    if (pending.length === 0) {
      await sendMessage(
        chat,
        `Nothing is waiting for <b>@${escapeHtml(owner)}</b>. The Guardian only speaks up when something needs you.`,
      );
      return;
    }
    await sendMessage(
      chat,
      `<b>${pending.length}</b> waiting for <b>@${escapeHtml(owner)}</b>:`,
    );
    // One message each, because each carries its own two buttons.
    for (const proposal of pending)
      await sendMessage(chat, proposalMessage(proposal), [
        [
          { text: "Approve", data: `a:${proposal.id}` },
          { text: "Refuse", data: `r:${proposal.id}` },
        ],
      ]);
    return;
  }

  if (command === "/ask") {
    if (!owner) {
      await sendMessage(chat, helpText(null));
      return;
    }
    const question = text.slice(command.length).trim();
    if (question.length < 3) {
      await sendMessage(
        chat,
        "Ask me something, like <code>/ask who still owes me money</code>.",
      );
      return;
    }
    const started = Date.now();
    try {
      const reply = await runAdvisor(owner, question);
      await sendMessage(
        chat,
        [
          escapeHtml(reply.answer),
          "",
          `<i>${escapeHtml(reply.caption)} · ${reply.rows.length} row${reply.rows.length === 1 ? "" : "s"}</i>`,
          rowsAsText(reply.rows),
        ].join("\n"),
      );
      // Same transcript the dashboard reads, with where it came from kept.
      // It joins the conversation the owner was last in rather than opening
      // one of its own: asking from the other room is still the same thread.
      await recordAdvisorTurn(
        owner,
        await latestChatId(owner),
        reply,
        Date.now() - started,
        "telegram",
      ).catch(() => {});
    } catch (error) {
      await sendMessage(
        chat,
        escapeHtml(
          error instanceof Error ? error.message : "That did not work.",
        ),
      );
    }
    return;
  }

  if (command === "/today") {
    if (!owner) {
      await sendMessage(chat, helpText(null));
      return;
    }
    try {
      const run = await runReporter(owner);
      await sendMessage(chat, escapeHtml(run.report));
    } catch (error) {
      await sendMessage(
        chat,
        escapeHtml(
          error instanceof Error ? error.message : "That did not work.",
        ),
      );
    }
    return;
  }

  await sendMessage(
    chat,
    owner
      ? "I did not recognise that. <code>/help</code> has the list."
      : helpText(null),
  );
}

async function onCallback(query: NonNullable<Update["callback_query"]>) {
  const callbackId = query.id;
  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  if (!callbackId || !chatId) return;
  const chat = String(chatId);

  const match = (query.data ?? "").match(/^([ar]):([A-Za-z0-9_-]{8,24})$/);
  if (!match) {
    await answerCallback(callbackId, "I did not understand that button.");
    return;
  }
  const [, action, proposalId] = match;

  const owner = await ownerForChat(chat);
  if (!owner) {
    await answerCallback(callbackId, "This chat is not linked to an account.");
    return;
  }

  try {
    // Scoped to the owner this chat is linked to, so a proposal id from
    // somewhere else finds nothing.
    const proposal =
      action === "a"
        ? await approveProposal(owner, proposalId, "telegram")
        : await refuseProposal(owner, proposalId);
    const said =
      proposal.status === "executed"
        ? "Approved, and carried out."
        : proposal.status === "approved"
          ? "Approved."
          : proposal.status === "refused"
            ? "Refused. Nothing moved."
            : `Now ${proposal.status}.`;
    await answerCallback(callbackId, said);
    if (messageId)
      await editMessage(
        chat,
        messageId,
        `<b>${escapeHtml(said)}</b>\n${escapeHtml(proposal.reason)}`,
      );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "That did not work.";
    await answerCallback(callbackId, message.slice(0, 180));
    if (messageId)
      await editMessage(chat, messageId, escapeHtml(message.slice(0, 300)));
  }
}
