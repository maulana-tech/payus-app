"use client";

import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatMinor, toDecimal } from "@/features/invoices/money";
import {
  ACCENTS,
  type Accent,
  MAX_PRODUCTS,
  THEMES,
  type Theme,
} from "@/features/storefront/config";
import { palette } from "@/features/storefront/theme";
import type { RouterOutputs } from "@/server/root";
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

// Building a page to sell from. What is edited here is configuration, not a
// page: the same shape an agent writes, so neither can produce something the
// renderer was not built to show.

type Store = RouterOutputs["storefront"]["mine"][number];

const origin = () =>
  typeof window === "undefined" ? "" : window.location.origin;

export function StorefrontScreen() {
  const stores = trpc.storefront.mine.useQuery();
  const [editing, setEditing] = useState<Store | "new" | null>(null);

  return (
    <div className="grid gap-4">
      <DescribeIt onWritten={(store) => setEditing(store)} />

      <Panel
        title="Your shops"
        hint="A page of things people can pay for, at an address you choose."
        action={
          <button
            type="button"
            className={dashButtonPrimary}
            onClick={() => setEditing("new")}
          >
            <Plus aria-hidden="true" />
            New shop
          </button>
        }
      >
        {stores.isLoading ? (
          <div className="px-5 py-12 text-center text-sm text-(--dash-ash)">
            Loading…
          </div>
        ) : (stores.data ?? []).length === 0 ? (
          <EmptyState
            title="No shop yet"
            action={
              <button
                type="button"
                className={dashButtonSecondary}
                onClick={() => setEditing("new")}
              >
                Open one
              </button>
            }
          >
            Put a few things on a page and send the address. Each one is paid
            the same way an invoice is, and lands in the same ledger.
          </EmptyState>
        ) : (
          <Ledger className="border-0 border-t border-(--dash-line-solid)">
            {stores.data?.map((store) => (
              <StoreRow key={store.id} store={store} onEdit={setEditing} />
            ))}
          </Ledger>
        )}
      </Panel>

      {editing ? (
        <EditorDialog
          store={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * The Builder: a description in, a draft out. What comes back is opened in
 * the editor rather than published, because putting a price in front of the
 * public is the owner's decision and not the model's.
 */
function DescribeIt({ onWritten }: { onWritten: (store: Store) => void }) {
  const utils = trpc.useUtils();
  const status = trpc.agents.status.useQuery();
  const [description, setDescription] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const run = trpc.agents.runBuilder.useMutation({
    onSuccess: (result) => {
      void utils.storefront.mine.invalidate();
      setDescription("");
      setNote(
        result.oddly.length > 0
          ? `Written as a draft. One thing to look at: ${result.oddly.join(
              ", ",
            )} ${result.oddly.length === 1 ? "is" : "are"} priced well above anything you have charged before.`
          : "Written as a draft — nothing is public until you publish it.",
      );
      onWritten(result.storefront);
    },
    onError: () => setNote(null),
  });

  if (status.data && !status.data.configured) return null;

  return (
    <Panel
      title="Describe it instead"
      hint="Say what you sell and the Builder writes the draft. It fills in our template; it never writes a page."
    >
      <form
        className="grid gap-3 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          setNote(null);
          run.mutate({ description });
        }}
      >
        <Field label="What is the shop?">
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="A coffee roastery in Bandung. Beans by the bag, a subscription, and a tip jar."
          />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-md text-sm text-(--dash-ash)">
            {note ?? "It writes a draft. You publish."}
          </p>
          <button
            type="submit"
            className={dashButtonSecondary}
            disabled={run.isPending || description.trim().length < 8}
          >
            {run.isPending ? "Writing…" : "Write the draft"}
          </button>
        </div>
        {run.error ? <ErrorNote>{run.error.message}</ErrorNote> : null}
      </form>
    </Panel>
  );
}

function StoreRow({
  store,
  onEdit,
}: {
  store: Store;
  onEdit: (store: Store) => void;
}) {
  const utils = trpc.useUtils();
  const publish = trpc.storefront.setPublished.useMutation({
    onSuccess: () => void utils.storefront.mine.invalidate(),
  });
  const path = `/shop/${store.slug}`;
  const published = store.state === "published";

  return (
    <div>
      <ListRow
        title={
          <>
            <span className="font-medium">{store.title}</span>
            <StatusChip status={published ? "active" : "archived"} />
            {store.writtenBy !== "owner" ? (
              <span className="text-[11px] font-semibold tracking-[0.1em] text-(--dash-ash) uppercase">
                written by {store.writtenBy}
              </span>
            ) : null}
          </>
        }
        meta={`${path} · ${store.products.length} item${
          store.products.length === 1 ? "" : "s"
        }`}
        actions={
          <>
            {published ? (
              <CopyButton value={`${origin()}${path}`} label="Link" />
            ) : null}
            {published ? (
              <a
                href={path}
                target="_blank"
                rel="noreferrer"
                className={dashIconButton}
                aria-label={`Open ${store.title}`}
              >
                <ExternalLink aria-hidden="true" />
              </a>
            ) : null}
            <button
              type="button"
              className={dashButtonSecondary}
              onClick={() => onEdit(store)}
            >
              Edit
            </button>
            <button
              type="button"
              className={published ? dashButtonSecondary : dashButtonPrimary}
              disabled={publish.isPending}
              onClick={() =>
                publish.mutate({ id: store.id, published: !published })
              }
            >
              {published ? "Unpublish" : "Publish"}
            </button>
          </>
        }
      />
      {publish.error ? <ErrorNote>{publish.error.message}</ErrorNote> : null}
    </div>
  );
}

type Line = { name: string; description: string; price: string };

const emptyLine: Line = { name: "", description: "", price: "" };

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

function EditorDialog({
  store,
  onClose,
}: {
  store: Store | null;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [title, setTitle] = useState(store?.title ?? "");
  const [slug, setSlug] = useState(store?.slug ?? "");
  const [slugEdited, setSlugEdited] = useState(Boolean(store));
  const [blurb, setBlurb] = useState(store?.blurb ?? "");
  const [template, setTemplate] = useState<"shelf" | "tip">(
    store?.template ?? "shelf",
  );
  const [theme, setTheme] = useState<Theme>(store?.theme ?? "paper");
  const [accent, setAccent] = useState<Accent>(store?.accent ?? "clay");
  const [lines, setLines] = useState<Line[]>(
    store?.products.map((product) => ({
      name: product.name,
      description: product.description,
      price: product.priceMinor ? toDecimal(BigInt(product.priceMinor)) : "",
    })) ?? [{ ...emptyLine }],
  );

  const done = () => {
    void utils.storefront.mine.invalidate();
    onClose();
  };
  const create = trpc.storefront.create.useMutation({ onSuccess: done });
  const update = trpc.storefront.update.useMutation({ onSuccess: done });
  const saving = create.isPending || update.isPending;
  const error = create.error?.message ?? update.error?.message;

  const setLine = (index: number, patch: Partial<Line>) =>
    setLines((all) =>
      all.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    );

  const submit = () => {
    const config = {
      slug: slug || slugify(title),
      title,
      blurb,
      template,
      theme,
      accent,
      products: lines.map((line) => ({
        name: line.name,
        description: line.description,
        price: template === "tip" ? null : line.price || null,
      })),
    };
    if (store) update.mutate({ id: store.id, config });
    else create.mutate(config);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg" className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{store ? "Edit shop" : "New shop"}</DialogTitle>
          <DialogDescription>
            Publishing is a separate step, so you can get it right before anyone
            sees it. A tip jar lets the payer name the amount.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <Input
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (!slugEdited) setSlug(slugify(e.target.value));
                }}
                placeholder="Kopi Senja"
                required
              />
            </Field>
            <Field label="Address" hint={`${origin()}/shop/…`}>
              <Input
                value={slug}
                onChange={(e) => {
                  setSlugEdited(true);
                  setSlug(e.target.value);
                }}
                placeholder="kopi-senja"
                required
              />
            </Field>
          </div>

          <Field label="One line about it" hint="Optional">
            <Input
              value={blurb}
              onChange={(e) => setBlurb(e.target.value)}
              placeholder="Single-origin beans, roasted on Fridays"
            />
          </Field>

          <Field label="Kind">
            <select
              value={template}
              onChange={(e) => setTemplate(e.target.value as typeof template)}
              className="h-10 w-full rounded-lg border border-input bg-card/70 px-3 text-sm"
            >
              <option value="shelf">A shelf — things with prices</option>
              <option value="tip">A tip jar — the payer chooses</option>
            </select>
          </Field>

          <fieldset className="grid gap-3">
            <legend className="text-[11px] font-semibold tracking-[0.14em] text-(--dash-ash) uppercase">
              {template === "tip"
                ? "What they are supporting"
                : "What you sell"}
            </legend>
            {lines.map((line, index) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: positional rows
                key={index}
                className="grid grid-cols-[1fr_1.2fr_6.5rem_auto] items-center gap-2"
              >
                <Input
                  value={line.name}
                  onChange={(e) => setLine(index, { name: e.target.value })}
                  placeholder="Flat white"
                  aria-label={`Item ${index + 1} name`}
                  required
                />
                <Input
                  value={line.description}
                  onChange={(e) =>
                    setLine(index, { description: e.target.value })
                  }
                  placeholder="Short description"
                  aria-label={`Item ${index + 1} description`}
                />
                <Input
                  value={template === "tip" ? "" : line.price}
                  inputMode="decimal"
                  disabled={template === "tip"}
                  onChange={(e) => setLine(index, { price: e.target.value })}
                  placeholder={template === "tip" ? "—" : "25.00"}
                  aria-label={`Item ${index + 1} price`}
                />
                <button
                  type="button"
                  className={dashIconButton}
                  aria-label={`Remove item ${index + 1}`}
                  disabled={lines.length === 1}
                  onClick={() =>
                    setLines((all) => all.filter((_, i) => i !== index))
                  }
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </div>
            ))}
            {lines.length < MAX_PRODUCTS ? (
              <div>
                <button
                  type="button"
                  className={dashButtonSecondary}
                  onClick={() => setLines((all) => [...all, { ...emptyLine }])}
                >
                  <Plus aria-hidden="true" />
                  Add item
                </button>
              </div>
            ) : null}
          </fieldset>

          <Field label="Look">
            <div className="flex flex-wrap gap-2">
              {THEMES.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={theme === option}
                  onClick={() => setTheme(option)}
                  className={`rounded-full border px-4 py-1.5 text-sm capitalize transition-colors ${
                    theme === option
                      ? "border-(--dash-fg) bg-(--dash-fg) text-(--dash-surface)"
                      : "border-(--dash-line-strong) text-(--dash-fg)"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Accent">
            <div className="flex flex-wrap gap-2">
              {ACCENTS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-label={option}
                  aria-pressed={accent === option}
                  onClick={() => setAccent(option)}
                  className={`size-8 rounded-full border-2 transition-transform ${
                    accent === option
                      ? "scale-110 border-(--dash-fg)"
                      : "border-transparent"
                  }`}
                  style={{ background: palette(theme, option).accent }}
                />
              ))}
            </div>
          </Field>

          <Preview
            title={title}
            blurb={blurb}
            lines={lines}
            template={template}
            theme={theme}
            accent={accent}
          />

          {error ? <ErrorNote>{error}</ErrorNote> : null}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              className={dashButtonSecondary}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={dashButtonPrimary}
              disabled={saving}
            >
              {saving ? "Saving…" : store ? "Save" : "Create as draft"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The page as it will read, from the same values that will be stored. */
function Preview({
  title,
  blurb,
  lines,
  template,
  theme,
  accent,
}: {
  title: string;
  blurb: string;
  lines: Line[];
  template: "shelf" | "tip";
  theme: Theme;
  accent: Accent;
}) {
  const colours = palette(theme, accent);
  const price = (value: string) => {
    if (template === "tip") return "You choose";
    try {
      return value
        ? formatMinor(BigInt(Math.round(Number(value) * 100)))
        : "You choose";
    } catch {
      return "—";
    }
  };
  return (
    <div className="grid gap-2">
      <p className="text-[11px] font-semibold tracking-[0.14em] text-(--dash-ash) uppercase">
        How it will look
      </p>
      <div
        className="rounded-(--dash-radius) border border-(--dash-line-solid) p-6"
        style={{ background: colours.page, color: colours.text }}
      >
        <p className="font-(family-name:--font-landing-serif) text-3xl leading-tight font-light">
          {title || "Your shop"}
        </p>
        <span
          aria-hidden="true"
          className="mt-3 block h-px w-12"
          style={{ background: colours.accent }}
        />
        {blurb ? (
          <p className="mt-3 text-sm" style={{ color: colours.muted }}>
            {blurb}
          </p>
        ) : null}
        <ul className="mt-4 grid gap-2">
          {lines.map((line, index) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: positional rows
              key={index}
              className="flex justify-between gap-4 rounded-xl px-3 py-2.5 text-sm"
              style={{ background: colours.surface }}
            >
              <span className="min-w-0 truncate">
                {line.name || "Untitled"}
              </span>
              <span
                className="shrink-0 font-medium tabular-nums"
                style={{ color: colours.accent }}
              >
                {price(line.price)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
