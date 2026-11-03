"use client";

import { trpc } from "@/trpc/react";
import { CopyButton } from "./screens/kit";
import { dashButtonSecondary } from "./styles";

// Approvals in a chat window. The code is single use and proves the chat
// belongs to this account; the decision itself goes down the same guardian
// path as the dashboard's own buttons, so a chat can do no more than you.

export function TelegramRow() {
  const utils = trpc.useUtils();
  const status = trpc.notifications.telegram.useQuery();
  const code = trpc.notifications.telegramCode.useMutation({
    onSuccess: () => void utils.notifications.telegram.invalidate(),
  });
  const unlink = trpc.notifications.telegramUnlink.useMutation({
    onSuccess: () => void utils.notifications.telegram.invalidate(),
  });

  if (!status.data) return null;
  const { configured, linked } = status.data;
  const pending = status.data.code ?? code.data?.code ?? null;

  return (
    <div className="grid gap-3 rounded-(--dash-radius) bg-(--dash-surface) p-5 ring-1 ring-(--dash-line)">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-(--dash-ash) uppercase">
            Approvals on Telegram
          </p>
          <p className="mt-1 text-[15px]">
            {!configured
              ? "No bot is configured on this deployment, so approvals stay in here."
              : linked
                ? "Linked. Anything the Guardian holds arrives in your chat with the buttons to decide it."
                : "Decide what the Guardian holds from your phone, without opening the dashboard."}
          </p>
        </div>
        {configured ? (
          linked ? (
            <button
              type="button"
              className={dashButtonSecondary}
              disabled={unlink.isPending}
              onClick={() => unlink.mutate()}
            >
              Unlink
            </button>
          ) : (
            <button
              type="button"
              className={dashButtonSecondary}
              disabled={code.isPending}
              onClick={() => code.mutate()}
            >
              {pending ? "New code" : "Link a chat"}
            </button>
          )
        ) : null}
      </div>

      {configured && !linked && pending ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-(--dash-line) pt-3">
          <p className="min-w-0 text-sm text-(--dash-ash)">
            Send the bot{" "}
            <code className="rounded bg-(--dash-tint) px-1.5 py-0.5 text-(--dash-fg)">
              /start {pending}
            </code>{" "}
            — the code works once, and only for this account.
          </p>
          <CopyButton value={`/start ${pending}`} label="Copy" />
        </div>
      ) : null}
    </div>
  );
}
