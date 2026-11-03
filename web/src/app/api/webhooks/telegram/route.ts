import {
  answerCallback,
  editMessage,
  escapeHtml,
  sendMessage,
  telegramConfigured,
  telegramSecret,
} from "@/server/lib/telegram";
import {
  approveProposal,
  refuseProposal,
} from "@/server/modules/guardian/guardian.service";
import {
  claimCode,
  ownerForChat,
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

  if (update.message) await onMessage(update.message);
  else if (update.callback_query) await onCallback(update.callback_query);
  // Telegram retries anything that is not a 2xx, and a retry of a decision
  // is not something we want, so handled or not the answer is the same.
  return ok();
}

async function onMessage(message: NonNullable<Update["message"]>) {
  const chatId = message.chat?.id;
  if (!chatId) return;
  const chat = String(chatId);
  const text = (message.text ?? "").trim();

  const code = text.match(/^\/start(?:\s+(\S+))?$/)?.[1];
  if (!code) {
    await sendMessage(
      chat,
      "Send me the code from your Payus settings, like <code>/start abc123</code>, and I will bring approvals here.",
    );
    return;
  }

  const owner = await claimCode(code, chat);
  await sendMessage(
    chat,
    owner
      ? `Linked to <b>@${escapeHtml(owner)}</b>. Anything the Guardian holds will arrive here, with the buttons to decide it.`
      : "That code is not one of ours, or it has been used already. Open Payus → Settings for a fresh one.",
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
