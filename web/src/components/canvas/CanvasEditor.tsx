"use client";

import {
  ArrowLeft,
  ExternalLink,
  Plus,
  Smartphone,
  Tablet,
  Trash2,
  Monitor as Wide,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Segmented } from "@/components/dashboard/Segmented";
import { Field } from "@/components/dashboard/screens/InvoicesScreen";
import { ErrorNote, StatusChip } from "@/components/dashboard/screens/kit";
import {
  dashButtonPrimary,
  dashButtonSecondary,
  dashFocus,
  dashIconButton,
} from "@/components/dashboard/styles";
import { useSession } from "@/components/SessionProvider";
import { StorefrontPage } from "@/components/storefront/StorefrontPanel";
import { Input } from "@/components/ui/input";
import {
  ACCENTS,
  MAX_HTML,
  MAX_PRODUCTS,
  MAX_QUANTITY,
  type Template,
  THEMES,
} from "@/features/storefront/config";
import {
  blankDraft,
  type Draft,
  draftFrom,
  emptyLine,
  type Line,
  slugify,
  toInput,
  toPreview,
} from "@/features/storefront/draft";
import { palette } from "@/features/storefront/theme";
import { trpc } from "@/trpc/react";
import type { HtmlEditorHandle } from "./HtmlEditor";
import { SNIPPETS } from "./snippets";

// The canvas: the shop's own page at full size on one side, and what makes
// it on the other. It is a page and not a dialog on purpose — a window you
// write a page through should be the size of the page.

const HtmlEditor = dynamic(() => import("./HtmlEditor"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center text-sm text-(--dash-ash)">
      Opening the editor…
    </div>
  ),
});

type Tab = "page" | "items" | "html" | "look";
type Device = "phone" | "tablet" | "wide";

const WIDTH: Record<Device, number | null> = {
  phone: 414,
  tablet: 820,
  wide: null,
};

export function CanvasEditor({ id }: { id: string }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const { username } = useSession();
  const stores = trpc.storefront.mine.useQuery();
  const isNew = id === "new";
  const store = isNew ? null : stores.data?.find((row) => row.id === id);

  const [draft, setDraft] = useState<Draft | null>(isNew ? blankDraft() : null);
  const [saved, setSaved] = useState<string | null>(
    isNew ? JSON.stringify(blankDraft()) : null,
  );
  const [tab, setTab] = useState<Tab>(isNew ? "page" : "html");
  const [device, setDevice] = useState<Device>("wide");
  const [slugEdited, setSlugEdited] = useState(!isNew);

  // Seeded once the shop arrives, and never again: re-seeding would throw
  // away what is being typed every time the list refetches.
  const seeded = useRef(false);
  useEffect(() => {
    if (isNew || seeded.current || !store) return;
    seeded.current = true;
    const next = draftFrom(store);
    setDraft(next);
    setSaved(JSON.stringify(next));
  }, [isNew, store]);

  const create = trpc.storefront.create.useMutation({
    onSuccess: (made) => {
      void utils.storefront.mine.invalidate();
      setSaved(JSON.stringify(draft));
      seeded.current = true;
      router.replace(`/canvas/${made.id}`);
    },
  });
  const update = trpc.storefront.update.useMutation({
    onSuccess: () => {
      void utils.storefront.mine.invalidate();
      setSaved(JSON.stringify(draft));
    },
  });
  const publish = trpc.storefront.setPublished.useMutation({
    onSuccess: () => void utils.storefront.mine.invalidate(),
  });

  const saving = create.isPending || update.isPending;
  const error =
    create.error?.message ?? update.error?.message ?? publish.error?.message;
  const dirty = draft !== null && JSON.stringify(draft) !== saved;

  const save = useCallback(() => {
    if (!draft || saving) return;
    const config = toInput(draft);
    if (store) update.mutate({ id: store.id, config });
    else if (isNew) create.mutate(config);
  }, [draft, saving, store, isNew, create, update]);

  // ⌘S / Ctrl+S, because this is an editor and that is what editors do.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  // Leaving with unsaved work is almost always a mistake.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const patch = (next: Partial<Draft>) =>
    setDraft((current) => (current ? { ...current, ...next } : current));

  if (!draft)
    return (
      <div className="grid h-svh place-items-center text-sm text-(--dash-ash)">
        {stores.isLoading
          ? "Opening…"
          : stores.isError
            ? "Could not load this shop."
            : "No such shop."}
      </div>
    );

  const published = store?.state === "published";
  const path = `/shop/${draft.slug || slugify(draft.title) || "your-shop"}`;

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-(--dash-bg) text-(--dash-fg)">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-(--dash-line-solid) px-4 py-3">
        <Link
          href="/storefront"
          aria-label="Back to your shops"
          className={dashIconButton}
        >
          <ArrowLeft aria-hidden="true" />
        </Link>
        <div className="min-w-0">
          <p className="flex items-center gap-2 truncate text-sm font-medium">
            {draft.title || "New shop"}
            <StatusChip status={published ? "live" : "draft"} />
          </p>
          <p className="truncate text-[12px] text-(--dash-ash)">
            {path} · {dirty ? "Unsaved changes" : saving ? "Saving…" : "Saved"}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {published ? (
            <a
              href={path}
              target="_blank"
              rel="noreferrer"
              className={dashButtonSecondary}
            >
              <ExternalLink aria-hidden="true" />
              Open
            </a>
          ) : null}
          {store ? (
            <button
              type="button"
              className={dashButtonSecondary}
              disabled={publish.isPending}
              onClick={() =>
                publish.mutate({ id: store.id, published: !published })
              }
            >
              {published ? "Unpublish" : "Publish"}
            </button>
          ) : null}
          <button
            type="button"
            className={dashButtonPrimary}
            disabled={saving || !dirty}
            onClick={save}
          >
            {saving ? "Saving…" : store ? "Save" : "Create as draft"}
          </button>
        </div>
      </header>

      {error ? (
        <div className="shrink-0 px-4 pt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Stacked on a narrow screen, side by side from `lg`: the editor
            takes a fixed slice so the page below it is never squeezed out. */}
        <section className="flex h-[55svh] min-h-0 w-full shrink-0 flex-col border-b border-(--dash-line-solid) lg:h-auto lg:w-[clamp(26rem,34vw,34rem)] lg:border-r lg:border-b-0">
          <div className="shrink-0 border-b border-(--dash-line-solid) p-3">
            <Segmented
              aria-label="What to edit"
              value={tab}
              onChange={setTab}
              options={[
                { value: "page", label: "Page" },
                { value: "items", label: "Items" },
                { value: "html", label: "HTML" },
                { value: "look", label: "Look" },
              ]}
            />
          </div>

          {tab === "html" ? (
            <HtmlPane
              value={draft.html}
              onChange={(html) => patch({ html })}
              removedFor={draft}
            />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {tab === "page" ? (
                <PageFields
                  draft={draft}
                  patch={patch}
                  slugEdited={slugEdited}
                  onSlugEdited={() => setSlugEdited(true)}
                />
              ) : tab === "items" ? (
                <ItemFields draft={draft} setDraft={setDraft} />
              ) : (
                <LookFields draft={draft} patch={patch} />
              )}
            </div>
          )}
        </section>

        <section className="flex min-h-0 flex-1 flex-col bg-(--dash-tint)">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-(--dash-line-solid) px-4 py-2">
            <p className="text-[11px] font-semibold tracking-[0.14em] text-(--dash-ash) uppercase">
              The page itself
            </p>
            <div className="flex items-center gap-1">
              {(
                [
                  ["phone", Smartphone, "Phone"],
                  ["tablet", Tablet, "Tablet"],
                  ["wide", Wide, "Full width"],
                ] as const
              ).map(([value, Icon, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-label={label}
                  aria-pressed={device === value}
                  onClick={() => setDevice(value)}
                  className={`${dashIconButton} ${
                    device === value ? "bg-(--dash-tint) text-(--dash-fg)" : ""
                  }`}
                >
                  <Icon aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>

          <Canvas draft={draft} owner={username ?? "you"} device={device} />
        </section>
      </div>
    </div>
  );
}

/**
 * The live page. The preview of the HTML block comes back from the server's
 * sanitiser, so the canvas shows what would be published and not the draft.
 */
function Canvas({
  draft,
  owner,
  device,
}: {
  draft: Draft;
  owner: string;
  device: Device;
}) {
  const [debounced, setDebounced] = useState(draft.html);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(draft.html), 300);
    return () => clearTimeout(timer);
  }, [draft.html]);

  const preview = trpc.storefront.previewHtml.useQuery(
    { html: debounced },
    { enabled: debounced.trim().length > 0, staleTime: 60_000 },
  );
  const clean = debounced.trim() ? (preview.data?.clean ?? "") : "";
  const shop = useMemo(
    () => toPreview(draft, owner, clean),
    [draft, owner, clean],
  );
  const width = WIDTH[device];

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <div
        style={width ? { width, maxWidth: "100%" } : undefined}
        className="mx-auto overflow-hidden rounded-(--dash-radius) border border-(--dash-line-solid) shadow-sm"
      >
        <StorefrontPage shop={shop} preview />
      </div>
    </div>
  );
}

/** The HTML field, at the size of a page rather than a pop-up. */
function HtmlPane({
  value,
  onChange,
  removedFor,
}: {
  value: string;
  onChange: (html: string) => void;
  removedFor: Draft;
}) {
  const editor = useRef<HtmlEditorHandle | null>(null);
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), 300);
    return () => clearTimeout(timer);
  }, [value]);

  const check = trpc.storefront.previewHtml.useQuery(
    { html: debounced },
    { enabled: debounced.trim().length > 0, staleTime: 60_000 },
  );
  const removed = debounced.trim() ? (check.data?.removed ?? []) : [];
  const colours = palette(removedFor.theme, removedFor.accent);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap gap-1 border-b border-(--dash-line-solid) p-2">
        {SNIPPETS.map((snippet) => (
          <button
            key={snippet.label}
            type="button"
            title={snippet.hint}
            onClick={() => editor.current?.insert(snippet.body)}
            className={`rounded-full border border-(--dash-line-strong) px-3 py-1 text-[12px] text-(--dash-fg) transition-colors hover:bg-(--dash-fg) hover:text-(--dash-surface) ${dashFocus}`}
          >
            {snippet.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <HtmlEditor
          value={value}
          onChange={onChange}
          handle={(api) => {
            editor.current = api;
          }}
        />
      </div>

      <div className="shrink-0 border-t border-(--dash-line-solid) p-3">
        {removed.length > 0 ? (
          <p className="text-[13px] text-(--dash-err)" role="status">
            Taken out by the sanitiser:{" "}
            {removed.map((t) => `<${t}>`).join(", ")}
          </p>
        ) : (
          <p className="text-[13px] text-(--dash-ash)">
            Headings, text, lists, tables, links and images, plus the{" "}
            <code style={{ color: colours.accent }}>shop-</code> classes above.
            Scripts, styles, frames and forms are removed on the way in, and
            what is left is shown in a sandbox that cannot run anything.
          </p>
        )}
        <p className="mt-1 text-[12px] text-(--dash-ash) tabular-nums">
          {value.length}/{MAX_HTML}
        </p>
      </div>
    </div>
  );
}

function PageFields({
  draft,
  patch,
  slugEdited,
  onSlugEdited,
}: {
  draft: Draft;
  patch: (next: Partial<Draft>) => void;
  slugEdited: boolean;
  onSlugEdited: () => void;
}) {
  return (
    <div className="grid gap-4">
      <Field label="Name">
        <Input
          value={draft.title}
          onChange={(e) =>
            patch({
              title: e.target.value,
              ...(slugEdited ? {} : { slug: slugify(e.target.value) }),
            })
          }
          placeholder="Kopi Senja"
        />
      </Field>
      <Field label="Address" hint="/shop/…">
        <Input
          value={draft.slug}
          onChange={(e) => {
            onSlugEdited();
            patch({ slug: e.target.value });
          }}
          placeholder="kopi-senja"
        />
      </Field>
      <Field label="One line about it" hint="Optional">
        <Input
          value={draft.blurb}
          onChange={(e) => patch({ blurb: e.target.value })}
          placeholder="Single-origin beans, roasted on Fridays"
        />
      </Field>
      <Field label="Kind">
        <select
          value={draft.template}
          onChange={(e) => patch({ template: e.target.value as Template })}
          className="h-10 w-full rounded-lg border border-input bg-card/70 px-3 text-sm"
        >
          <option value="shelf">A shelf — items side by side</option>
          <option value="menu">A menu — a compact list</option>
          <option value="single">One thing — a single offer</option>
          <option value="tip">A tip jar — the payer chooses</option>
        </select>
      </Field>
      <p className="text-sm text-(--dash-ash)">
        Nothing is public until you publish it, and publishing is its own button
        — so you can get the page right first.
      </p>
    </div>
  );
}

function ItemFields({
  draft,
  setDraft,
}: {
  draft: Draft;
  setDraft: (update: (current: Draft | null) => Draft | null) => void;
}) {
  const setLine = (index: number, patch: Partial<Line>) =>
    setDraft((current) =>
      current
        ? {
            ...current,
            lines: current.lines.map((line, i) =>
              i === index ? { ...line, ...patch } : line,
            ),
          }
        : current,
    );

  return (
    <fieldset className="grid gap-3">
      <legend className="text-[11px] font-semibold tracking-[0.14em] text-(--dash-ash) uppercase">
        {draft.template === "tip"
          ? "What they are supporting"
          : "What you sell"}
      </legend>
      {draft.lines.map((line, index) => {
        const open = draft.template === "tip" || !line.price.trim();
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: positional rows
            key={index}
            className="grid gap-2 rounded-(--dash-radius) border border-(--dash-line) p-3"
          >
            <div className="grid grid-cols-[1fr_6.5rem_auto] items-center gap-2">
              <Input
                value={line.name}
                onChange={(e) => setLine(index, { name: e.target.value })}
                placeholder="Flat white"
                aria-label={`Item ${index + 1} name`}
              />
              <Input
                value={draft.template === "tip" ? "" : line.price}
                inputMode="decimal"
                disabled={draft.template === "tip"}
                onChange={(e) => setLine(index, { price: e.target.value })}
                placeholder={draft.template === "tip" ? "—" : "25.00"}
                aria-label={`Item ${index + 1} price`}
              />
              <button
                type="button"
                className={dashIconButton}
                aria-label={`Remove item ${index + 1}`}
                disabled={draft.lines.length === 1}
                onClick={() =>
                  setDraft((current) =>
                    current
                      ? {
                          ...current,
                          lines: current.lines.filter((_, i) => i !== index),
                        }
                      : current,
                  )
                }
              >
                <Trash2 aria-hidden="true" />
              </button>
            </div>

            <Input
              value={line.description}
              onChange={(e) => setLine(index, { description: e.target.value })}
              placeholder="Short description"
              aria-label={`Item ${index + 1} description`}
            />

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
              {open ? (
                <span className="flex items-center gap-2">
                  <span className="text-(--dash-ash)">Between</span>
                  <Input
                    value={line.min}
                    inputMode="decimal"
                    onChange={(e) => setLine(index, { min: e.target.value })}
                    placeholder="2.00"
                    aria-label={`Item ${index + 1} lowest amount`}
                    className="h-9 w-24"
                  />
                  <span className="text-(--dash-ash)">and</span>
                  <Input
                    value={line.max}
                    inputMode="decimal"
                    onChange={(e) => setLine(index, { max: e.target.value })}
                    placeholder="200.00"
                    aria-label={`Item ${index + 1} highest amount`}
                    className="h-9 w-24"
                  />
                </span>
              ) : (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={line.quantity}
                    onChange={(e) =>
                      setLine(index, { quantity: e.target.checked })
                    }
                    className="size-4 accent-(--dash-fg)"
                  />
                  <span>Payer picks how many</span>
                  {line.quantity ? (
                    <Input
                      value={line.limit}
                      inputMode="numeric"
                      onChange={(e) =>
                        setLine(index, { limit: e.target.value })
                      }
                      aria-label={`Item ${index + 1} limit per order`}
                      className="h-9 w-16"
                    />
                  ) : null}
                  {line.quantity ? (
                    <span className="text-(--dash-ash)">
                      at most, up to {MAX_QUANTITY}
                    </span>
                  ) : null}
                </label>
              )}
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={line.soldOut}
                  onChange={(e) =>
                    setLine(index, { soldOut: e.target.checked })
                  }
                  className="size-4 accent-(--dash-fg)"
                />
                <span>Sold out</span>
              </label>
            </div>
          </div>
        );
      })}
      {draft.lines.length < MAX_PRODUCTS ? (
        <div>
          <button
            type="button"
            className={dashButtonSecondary}
            onClick={() =>
              setDraft((current) =>
                current
                  ? { ...current, lines: [...current.lines, { ...emptyLine }] }
                  : current,
              )
            }
          >
            <Plus aria-hidden="true" />
            Add item
          </button>
        </div>
      ) : null}
    </fieldset>
  );
}

function LookFields({
  draft,
  patch,
}: {
  draft: Draft;
  patch: (next: Partial<Draft>) => void;
}) {
  return (
    <div className="grid gap-4">
      <Field label="Look">
        <div className="flex flex-wrap gap-2">
          {THEMES.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={draft.theme === option}
              onClick={() => patch({ theme: option })}
              className={`rounded-full border px-4 py-1.5 text-sm capitalize transition-colors ${
                draft.theme === option
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
              aria-pressed={draft.accent === option}
              onClick={() => patch({ accent: option })}
              className={`size-8 rounded-full border-2 transition-transform ${
                draft.accent === option
                  ? "scale-110 border-(--dash-fg)"
                  : "border-transparent"
              }`}
              style={{ background: palette(draft.theme, option).accent }}
            />
          ))}
        </div>
      </Field>
      <p className="text-sm text-(--dash-ash)">
        A shop chooses a look rather than describing one: the layout, the
        palette and the HTML block are the whole vocabulary, and the page is
        drawn from them.
      </p>
    </div>
  );
}
