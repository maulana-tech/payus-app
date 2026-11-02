"use client";

import { KeyRound, Plus, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { trpc } from "@/trpc/react";
import {
  dashButtonPrimary,
  dashButtonSecondary,
  dashIconButton,
} from "../styles";
import { Field } from "./InvoicesScreen";
import {
  CopyButton,
  EmptyState,
  ErrorNote,
  Ledger,
  ListRow,
  Panel,
  StatusChip,
} from "./kit";

// Keys, the webhook endpoint, and what we actually sent it. The secret of a
// new key is shown exactly once, because only its hash is stored.

export function DevelopersScreen() {
  const overview = trpc.developer.overview.useQuery();
  const [naming, setNaming] = useState(false);
  const [issued, setIssued] = useState<{ name: string; key: string } | null>(
    null,
  );

  if (overview.isLoading)
    return (
      <div className="px-5 py-12 text-center text-sm text-(--dash-ash)">
        Loading…
      </div>
    );

  const data = overview.data;
  const apiBase =
    data?.apiBase ||
    `${typeof window === "undefined" ? "" : window.location.origin}/api/v1`;

  return (
    <div className="grid gap-4">
      <Panel
        title="API keys"
        hint={`Send one as Authorization: Bearer … to ${apiBase}`}
        action={
          <button
            type="button"
            className={dashButtonPrimary}
            onClick={() => setNaming(true)}
          >
            <Plus aria-hidden="true" />
            New key
          </button>
        }
      >
        {(data?.keys.length ?? 0) === 0 ? (
          <EmptyState
            title="No keys yet"
            action={
              <button
                type="button"
                className={dashButtonSecondary}
                onClick={() => setNaming(true)}
              >
                Create a key
              </button>
            }
          >
            A key lets your server create checkouts and read their status.
          </EmptyState>
        ) : (
          <Ledger className="border-0 border-t border-(--dash-line-solid)">
            {data?.keys.map((key) => (
              <KeyRow key={key.id} apiKey={key} />
            ))}
          </Ledger>
        )}
      </Panel>

      <WebhookPanel webhook={data?.webhook ?? null} />

      <Panel
        title="Recent deliveries"
        hint="The last 20 events we sent you, with what your server answered."
      >
        {(data?.deliveries.length ?? 0) === 0 ? (
          <EmptyState title="Nothing sent yet">
            Events appear here once an invoice is paid, or when you send a test.
          </EmptyState>
        ) : (
          <Ledger className="border-0 border-t border-(--dash-line-solid)">
            {data?.deliveries.map((delivery) => (
              <ListRow
                key={delivery.id}
                title={
                  <>
                    <span className="font-medium">{delivery.event}</span>
                    <StatusChip
                      status={
                        delivery.status === "delivered" ? "paid" : "overdue"
                      }
                    />
                  </>
                }
                meta={`${delivery.attempts} attempt${delivery.attempts === 1 ? "" : "s"}${
                  delivery.responseStatus
                    ? ` · HTTP ${delivery.responseStatus}`
                    : ""
                }${delivery.error ? ` · ${delivery.error}` : ""}`}
                trailing={
                  <span className="text-sm text-(--dash-ash)">
                    {new Date(delivery.createdAt).toLocaleString()}
                  </span>
                }
              />
            ))}
          </Ledger>
        )}
      </Panel>

      <NameKeyDialog
        open={naming}
        onOpenChange={setNaming}
        onCreated={(created) => setIssued(created)}
      />
      <SecretDialog issued={issued} onClose={() => setIssued(null)} />
    </div>
  );
}

function KeyRow({
  apiKey,
}: {
  apiKey: {
    id: string;
    name: string;
    preview: string;
    createdAt: string;
    lastUsedAt: string | null;
  };
}) {
  const utils = trpc.useUtils();
  const revoke = trpc.developer.revokeKey.useMutation({
    onSuccess: () => void utils.developer.overview.invalidate(),
  });
  return (
    <div>
      <ListRow
        lead={
          <KeyRound className="size-4 text-(--dash-ash)" aria-hidden="true" />
        }
        title={<span className="font-medium">{apiKey.name}</span>}
        meta={`${apiKey.preview} · created ${new Date(apiKey.createdAt).toLocaleDateString()}${
          apiKey.lastUsedAt
            ? ` · last used ${new Date(apiKey.lastUsedAt).toLocaleDateString()}`
            : " · never used"
        }`}
        actions={
          <button
            type="button"
            className={dashIconButton}
            aria-label={`Revoke ${apiKey.name}`}
            disabled={revoke.isPending}
            onClick={() => revoke.mutate({ id: apiKey.id })}
          >
            <Trash2 aria-hidden="true" />
          </button>
        }
      />
      {revoke.error ? <ErrorNote>{revoke.error.message}</ErrorNote> : null}
    </div>
  );
}

function WebhookPanel({
  webhook,
}: {
  webhook: { url: string; secret: string } | null;
}) {
  const utils = trpc.useUtils();
  const refresh = () => void utils.developer.overview.invalidate();
  const [url, setUrl] = useState(webhook?.url ?? "");
  const save = trpc.developer.setWebhook.useMutation({ onSuccess: refresh });
  const rotate = trpc.developer.rotateWebhookSecret.useMutation({
    onSuccess: refresh,
  });
  const remove = trpc.developer.deleteWebhook.useMutation({
    onSuccess: () => {
      setUrl("");
      refresh();
    },
  });
  const test = trpc.developer.testWebhook.useMutation({ onSuccess: refresh });
  const error =
    save.error?.message ??
    rotate.error?.message ??
    remove.error?.message ??
    test.error?.message;

  return (
    <Panel
      title="Webhook"
      hint="We POST signed events here and retry when your server is busy."
    >
      <div className="grid gap-4 p-5">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate({ url });
          }}
        >
          <div className="min-w-60 flex-1">
            <Field label="Endpoint">
              <Input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://api.yourshop.com/payus"
                required
              />
            </Field>
          </div>
          <button
            type="submit"
            className={dashButtonPrimary}
            disabled={save.isPending}
          >
            {webhook ? "Update" : "Save"}
          </button>
        </form>

        {webhook ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--dash-line) pt-4">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold tracking-[0.14em] text-(--dash-ash) uppercase">
                  Signing secret
                </p>
                <p className="mt-1 truncate font-(family-name:--font-landing-mono) text-sm">
                  {webhook.secret}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <CopyButton value={webhook.secret} label="Copy secret" />
                <button
                  type="button"
                  className={dashButtonSecondary}
                  disabled={rotate.isPending}
                  onClick={() => rotate.mutate()}
                >
                  Rotate
                </button>
              </div>
            </div>
            <p className="text-sm text-(--dash-ash)">
              Verify the <code>Payus-Signature</code> header against the raw
              body with this secret before trusting an event.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className={dashButtonSecondary}
                disabled={test.isPending}
                onClick={() => test.mutate()}
              >
                <Send aria-hidden="true" />
                {test.isPending ? "Sending…" : "Send a test event"}
              </button>
              <button
                type="button"
                className={dashButtonSecondary}
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                Remove
              </button>
            </div>
          </>
        ) : null}
        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </div>
    </Panel>
  );
}

function NameKeyDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (created: { name: string; key: string }) => void;
}) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const create = trpc.developer.createKey.useMutation({
    onSuccess: (created) => {
      void utils.developer.overview.invalidate();
      onOpenChange(false);
      setName("");
      onCreated({ name: created.name, key: created.key });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New API key</DialogTitle>
          <DialogDescription>
            Name it after the thing that will use it, so revoking the right one
            later is obvious.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate({ name });
          }}
        >
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Production server"
              required
            />
          </Field>
          {create.error ? <ErrorNote>{create.error.message}</ErrorNote> : null}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              className={dashButtonSecondary}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={dashButtonPrimary}
              disabled={create.isPending}
            >
              {create.isPending ? "Creating…" : "Create key"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SecretDialog({
  issued,
  onClose,
}: {
  issued: { name: string; key: string } | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(issued)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy {issued?.name} now</DialogTitle>
          <DialogDescription>
            Only a hash of this key is stored, so this is the one time it can be
            shown. Lose it and you make a new one.
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-(--dash-radius-sm) border border-(--dash-line-strong) bg-(--dash-tint) p-4 font-(family-name:--font-landing-mono) text-sm break-all">
          {issued?.key}
        </p>
        <div className="flex justify-end gap-3">
          <CopyButton value={issued?.key ?? ""} label="Copy key" />
          <button type="button" className={dashButtonPrimary} onClick={onClose}>
            Done
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
