import "server-only";
import { and, eq, isNotNull } from "drizzle-orm";
import { formatMinor } from "../../../features/invoices/money";
import { newId } from "../../../lib/ids";
import { getDb, telegramLinks } from "../../db/client";
import {
  escapeHtml,
  sendMessage,
  telegramConfigured,
} from "../../lib/telegram";
import type { ProposalView } from "../guardian/guardian.service";

// Linking a Telegram chat to an account, and asking it to decide. The chat
// is proved by a single-use code the owner sends the bot: we never take a
// chat id from a message body, and a code is spent the moment it works.

export type TelegramStatus = {
  configured: boolean;
  linked: boolean;
  /** Only while unlinked: what to send the bot. */
  code: string | null;
};

export async function telegramStatus(owner: string): Promise<TelegramStatus> {
  const row = await linkRow(owner);
  return {
    configured: telegramConfigured(),
    linked: Boolean(row?.chatId),
    code: row?.chatId ? null : (row?.code ?? null),
  };
}

/** The code to send the bot, made on first ask and kept until it is used. */
export async function linkCode(owner: string): Promise<string> {
  const existing = await linkRow(owner);
  if (existing?.chatId) throw new Error("This account is already linked.");
  if (existing?.code) return existing.code;
  const code = newId(10);
  await getDb()
    .insert(telegramLinks)
    .values({ owner, code })
    .onConflictDoUpdate({
      target: telegramLinks.owner,
      set: { code, updatedAt: new Date() },
    });
  return code;
}

/** Starts again: a new code, and the old chat forgotten. */
export async function unlinkTelegram(owner: string): Promise<void> {
  await getDb()
    .update(telegramLinks)
    .set({ chatId: null, code: null, linkedAt: null, updatedAt: new Date() })
    .where(eq(telegramLinks.owner, owner));
}

/**
 * Spends a code. Returns the owner it belonged to, or null — and a code
 * that worked once cannot work again, which is what makes the chat proof.
 */
export async function claimCode(
  code: string,
  chatId: string,
): Promise<string | null> {
  const [row] = await getDb()
    .update(telegramLinks)
    .set({ chatId, code: null, linkedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(telegramLinks.code, code), isNotNull(telegramLinks.code)))
    .returning();
  return row?.owner ?? null;
}

/** Which account a chat may act for. The only way a chat gets authority. */
export async function ownerForChat(chatId: string): Promise<string | null> {
  const [row] = await getDb()
    .select()
    .from(telegramLinks)
    .where(eq(telegramLinks.chatId, chatId))
    .limit(1);
  return row?.owner ?? null;
}

export async function chatForOwner(owner: string): Promise<string | null> {
  return (await linkRow(owner))?.chatId ?? null;
}

async function linkRow(owner: string) {
  const [row] = await getDb()
    .select()
    .from(telegramLinks)
    .where(eq(telegramLinks.owner, owner))
    .limit(1);
  return row ?? null;
}

/** What a proposal reads as in a chat window. */
export function proposalMessage(proposal: ProposalView): string {
  const what =
    proposal.kind === "payout"
      ? `Release ${escapeHtml(
          formatMinor(
            BigInt(String(proposal.payload.amountMinor ?? "0")),
            String(proposal.payload.currency ?? "USD"),
          ),
        )} to ${escapeHtml(String(proposal.payload.destination ?? "—"))}`
      : `Change the split: ${escapeHtml(String(proposal.payload.name ?? "a rule"))}`;
  return [
    "<b>Waiting for you</b>",
    what,
    "",
    escapeHtml(proposal.reason),
    `<i>Proposed by ${escapeHtml(proposal.proposedBy)}</i>`,
  ].join("\n");
}

/**
 * Asks the owner's chat to decide. Never throws into the money path: a bot
 * that is down must not stop a proposal being recorded.
 */
export async function askOnTelegram(
  owner: string,
  proposal: ProposalView,
): Promise<void> {
  try {
    if (!telegramConfigured()) return;
    const chatId = await chatForOwner(owner);
    if (!chatId) return;
    await sendMessage(chatId, proposalMessage(proposal), [
      [
        { text: "Approve", data: `a:${proposal.id}` },
        { text: "Refuse", data: `r:${proposal.id}` },
      ],
    ]);
  } catch {
    // The dashboard still has it under "Waiting for you".
  }
}
