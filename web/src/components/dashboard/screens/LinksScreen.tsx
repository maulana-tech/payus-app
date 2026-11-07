"use client";

import {
  Archive,
  Check,
  ExternalLink,
  Link2,
  Plus,
  QrCode,
  RotateCcw,
} from "lucide-react";
import { type CSSProperties, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { RouterOutputs } from "@/server/root";
import { trpc } from "@/trpc/react";
import { PaymentQrDialog } from "../PaymentQrDialog";
import { dashButtonPrimary, dashButtonSecondary } from "../styles";
import { Field } from "./InvoicesScreen";
import {
  EmptyState,
  ErrorNote,
  Ledger,
  ListRow,
  Money,
  Panel,
  RowMenu,
  RowMenuItem,
  RowMenuSeparator,
  StatusChip,
} from "./kit";

const origin = () =>
  typeof window === "undefined" ? "" : window.location.origin;

export function LinksScreen({ username }: { username: string }) {
  const links = trpc.paymentLinks.mine.useQuery();
  const [creating, setCreating] = useState(false);
  const active = (links.data ?? []).filter((l) => l.state === "active");
  const archived = (links.data ?? []).filter((l) => l.state === "archived");

  return (
    <div className="grid gap-4">
      {/* The button belongs in the panel header, as it does on every other
          screen: on its own row it left a band of empty page above the list. */}
      <Panel
        title="Active"
        hint={`Anyone holding the address can pay. Yours all begin ${origin()}/pay/${username}/`}
        action={
          <button
            type="button"
            className={dashButtonPrimary}
            onClick={() => setCreating(true)}
          >
            <Plus aria-hidden="true" />
            New link
          </button>
        }
      >
        {links.isLoading ? (
          <div className="px-5 py-12 text-center text-sm text-(--dash-ash)">
            Loading…
          </div>
        ) : active.length === 0 ? (
          <EmptyState
            title="No links yet"
            action={
              <button
                type="button"
                className={dashButtonSecondary}
                onClick={() => setCreating(true)}
              >
                Make one
              </button>
            }
          >
            A link is the quickest way to be paid: name it, price it or leave
            the amount open, and send the address.
          </EmptyState>
        ) : (
          <Ledger
            className="border-0 border-t border-(--dash-line-solid)"
            style={{ "--row-actions": "12.5rem" } as CSSProperties}
          >
            {active.map((link) => (
              <LinkRow key={link.id} link={link} username={username} />
            ))}
          </Ledger>
        )}
      </Panel>

      {archived.length > 0 ? (
        <Panel title="Archived" hint="Not payable; the address is kept.">
          <Ledger
            className="border-0 border-t border-(--dash-line-solid)"
            style={{ "--row-actions": "12.5rem" } as CSSProperties}
          >
            {archived.map((link) => (
              <LinkRow key={link.id} link={link} username={username} />
            ))}
          </Ledger>
        </Panel>
      ) : null}

      <CreateDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

type Link = RouterOutputs["paymentLinks"]["mine"][number];

function LinkRow({ link, username }: { link: Link; username: string }) {
  const utils = trpc.useUtils();
  // A link is usually sent to a phone, and the shortest way to a phone is
  // a code on a screen someone is already looking at.
  const [showQr, setShowQr] = useState(false);
  const qrButton = useRef<HTMLButtonElement | null>(null);
  const setArchived = trpc.paymentLinks.setArchived.useMutation({
    onSuccess: () => void utils.paymentLinks.mine.invalidate(),
  });
  const path = `/pay/${username}/${link.slug}`;
  const archived = link.state === "archived";
  const [copied, setCopied] = useState(false);
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${origin()}${path}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div>
      <ListRow
        title={
          <>
            <span className="font-medium">{link.title}</span>
            {/* Inside the "Active" panel every row is active; the chip only
                earns its place where the state is the exception. */}
            {archived ? <StatusChip status={link.state} /> : null}
          </>
        }
        meta={`${path}${link.description ? ` · ${link.description}` : ""}`}
        trailing={
          link.amountMinor ? (
            <Money minor={link.amountMinor} currency={link.currency} />
          ) : (
            <span className="text-sm text-(--dash-ash)">Payer chooses</span>
          )
        }
        // Copying the address is what people come here to do; the rest is
        // one menu, the same shape every list screen uses.
        actions={
          <>
            <button
              type="button"
              className={dashButtonSecondary}
              onClick={() => void copyLink()}
            >
              {copied ? (
                <Check aria-hidden="true" />
              ) : (
                <Link2 aria-hidden="true" />
              )}
              {copied ? "Copied" : "Copy link"}
            </button>
            <RowMenu label={`More for ${link.title}`}>
              <RowMenuItem
                icon={QrCode}
                onSelect={() => {
                  qrButton.current?.focus();
                  setShowQr(true);
                }}
              >
                Show a QR code
              </RowMenuItem>
              <RowMenuItem
                icon={ExternalLink}
                onSelect={() => window.open(path, "_blank", "noreferrer")}
              >
                Open the pay page
              </RowMenuItem>
              <RowMenuSeparator />
              <RowMenuItem
                icon={archived ? RotateCcw : Archive}
                destructive={!archived}
                disabled={setArchived.isPending}
                onSelect={() =>
                  setArchived.mutate({ id: link.id, archived: !archived })
                }
              >
                {archived ? "Make it payable again" : "Archive this link"}
              </RowMenuItem>
            </RowMenu>
          </>
        }
      />
      {setArchived.error ? (
        <ErrorNote>{setArchived.error.message}</ErrorNote>
      ) : null}
      <PaymentQrDialog
        open={showQr}
        onOpenChange={setShowQr}
        url={`${origin()}${path}`}
        triggerRef={qrButton}
      />
    </div>
  );
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

function CreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");

  const create = trpc.paymentLinks.create.useMutation({
    onSuccess: () => {
      void utils.paymentLinks.mine.invalidate();
      onOpenChange(false);
      setTitle("");
      setSlug("");
      setSlugEdited(false);
      setDescription("");
      setAmount("");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New payment link</DialogTitle>
          <DialogDescription>
            Leave the amount empty to let the payer decide — useful for tips and
            donations.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate({
              slug: slug || slugify(title),
              title,
              description: description || null,
              amount: amount || null,
            });
          }}
        >
          <Field label="Title">
            <Input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (!slugEdited) setSlug(slugify(e.target.value));
              }}
              placeholder="Coffee"
              required
            />
          </Field>
          <Field label="Address" hint="Lowercase, hyphens">
            <Input
              value={slug}
              onChange={(e) => {
                setSlugEdited(true);
                setSlug(e.target.value);
              }}
              placeholder="coffee"
              required
            />
          </Field>
          <Field label="Amount" hint="Optional">
            <Input
              value={amount}
              inputMode="decimal"
              onChange={(e) => setAmount(e.target.value)}
              placeholder="25.00"
            />
          </Field>
          <Field label="Description" hint="Optional">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="One flat white"
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
              {create.isPending ? "Creating…" : "Create link"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
