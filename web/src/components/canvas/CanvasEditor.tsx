"use client";

import {
  ArrowLeft,
  ChevronDown,
  ExternalLink,
  Link2 as LinkIcon,
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
import { AgentPane } from "@/components/canvas/AgentPane";
import { PayLinkMenu } from "@/components/canvas/PayLinks";
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
import type { ShopHtmlEdit } from "@/components/storefront/ShopHtml";
import { StorefrontPage } from "@/components/storefront/StorefrontPanel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  type Block,
  drawnPositions,
  rendersNothing,
  toBlocks,
  toHtml,
} from "@/features/storefront/blocks";
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
import { starters } from "@/features/storefront/starters";
import { palette } from "@/features/storefront/theme";
import { trpc } from "@/trpc/react";
import { BlockEditor } from "./BlockEditor";
import type { HtmlEditorHandle } from "./HtmlEditor";
import { payLinkHtml, SNIPPET_GROUPS } from "./snippets";

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

type Tab = "page" | "items" | "blocks" | "html" | "look" | "agent";
type Device = "phone" | "tablet" | "wide";

/**
 * The server's sanitiser, run on what is being typed.
 *
 * `previewHtml` is a mutation rather than a query — a query's input rides
 * in the URL, and this input is a whole page — so the debounce and the
 * firing live here instead of in React Query's `enabled`.
 *
 * The last good answer is kept while the next one is in flight: a preview
 * that blanks between keystrokes is a preview nobody can work against.
 */
function useSanitised(html: string): { clean: string; removed: string[] } {
  const [result, setResult] = useState<{ clean: string; removed: string[] }>({
    clean: "",
    removed: [],
  });
  const run = trpc.storefront.previewHtml.useMutation({
    onSuccess: (data) =>
      setResult({ clean: data.clean, removed: data.removed }),
  });
  // The mutation object is new on every render; the call is not.
  const fire = useRef(run.mutate);
  fire.current = run.mutate;

  useEffect(() => {
    if (!html.trim()) {
      setResult({ clean: "", removed: [] });
      return;
    }
    const timer = setTimeout(() => fire.current({ html }), 300);
    return () => clearTimeout(timer);
  }, [html]);

  return result;
}

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
  // A new shop starts on Page, because it has no name yet; an existing one
  // opens on Blocks, which is the editor rather than the escape hatch.
  const [tab, setTab] = useState<Tab>(isNew ? "page" : "blocks");
  const [device, setDevice] = useState<Device>("wide");
  const [slugEdited, setSlugEdited] = useState(!isNew);
  // A new shop opens on the starters rather than on an empty page. Choosing
  // one only fills the draft; from then on it is an ordinary draft.
  const [picking, setPicking] = useState(isNew);
  const [highlight, setHighlight] = useState(0);
  // The page as blocks, held here because both panes edit it: the list on
  // the left and the page on the right. Seeded from the draft once the
  // shop arrives, then owned here.
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [openBlock, setOpenBlock] = useState<string | null>(null);
  // A page the Builder has proposed and the owner has not answered yet. The
  // canvas draws it instead of the draft, so an answer is judged as the
  // page it would become rather than as a list of block names.
  const [proposed, setProposed] = useState<string | null>(null);

  const patch = useCallback(
    (next: Partial<Draft>) =>
      setDraft((current) => (current ? { ...current, ...next } : current)),
    [],
  );

  const writeBlocks = useCallback(
    (next: Block[]) => {
      setBlocks(next);
      patch({ html: toHtml(next) });
    },
    [patch],
  );

  // The latest blocks, for the handlers the frame holds.
  //
  // `edit` is handed to `ShopHtml`, which uses it to attach itself to every
  // element in the frame. If that object changed on each keystroke, the
  // attaching would be torn down and redone while someone was typing. So
  // the handlers are built once and read the current list through a ref
  // instead of closing over it.
  const latest = useRef<{ blocks: Block[]; write: (next: Block[]) => void }>({
    blocks,
    write: writeBlocks,
  });
  latest.current = { blocks, write: writeBlocks };

  // Positions on the page, as the frame counts them. A stylesheet is in the
  // list and on the page, and is a position in neither.
  const drawn = useMemo(() => drawnPositions(blocks), [blocks]);

  /**
   * The page on the right, edited in place.
   *
   * `at` is a position in the frame, which the canvas has already checked
   * lines up with a position in this list. The element's new markup is read
   * back through the same reader the HTML tab uses, so a heading stays a
   * heading and a block the editor never understood stays exactly what it
   * was.
   */
  const edit = useMemo<ShopHtmlEdit>(
    () => ({
      onSelect: (at) => {
        const { blocks: now } = latest.current;
        const index = drawnPositions(now)[at];
        setOpenBlock((open) =>
          index === undefined ? open : (now[index]?.id ?? open),
        );
      },
      onEdit: (at, outerHtml) => {
        const { blocks: now, write } = latest.current;
        const index = drawnPositions(now)[at];
        const old = index === undefined ? undefined : now[index];
        const read = toBlocks(outerHtml)[0];
        if (!old || !read) return;
        write(
          now.map((block, where) =>
            where === index ? { ...read, id: old.id } : block,
          ),
        );
      },
    }),
    [],
  );

  // Seeded once the shop arrives, and never again: re-seeding would throw
  // away what is being typed every time the list refetches.
  const seeded = useRef(false);
  useEffect(() => {
    if (isNew || seeded.current || !store) return;
    seeded.current = true;
    const next = draftFrom(store);
    setDraft(next);
    setSaved(JSON.stringify(next));
    const read = toBlocks(next.html);
    setBlocks(read);
    setOpenBlock(read[0]?.id ?? null);
    // Which tab owns this page is a fact about the page, not a setting. A
    // design someone wrote by hand reads as a handful of elements here —
    // the block list has nothing to offer it — so open where the work is.
    const drawnBlocks = read.filter((block) => !rendersNothing(block));
    if (
      drawnBlocks.length > 0 &&
      drawnBlocks.every((block) => block.kind === "html")
    )
      setTab("html");
  }, [isNew, store]);

  // The HTML tab writes the same field. Re-read when what it holds is no
  // longer what these blocks would write — on a tab change rather than on
  // every keystroke, because re-reading mints new ids and would take the
  // cursor out of whatever is being typed.
  //
  // The blocks are read to compare, not depended on: a dependency here
  // would re-run this on every edit the block editor itself makes, minting
  // new ids each time.
  const draftHtml = draft?.html;
  useEffect(() => {
    if (tab !== "blocks" || draftHtml === undefined) return;
    if (toHtml(latest.current.blocks) === draftHtml) return;
    const read = toBlocks(draftHtml);
    setBlocks(read);
    setOpenBlock((now) => (read.some((b) => b.id === now) ? now : null));
  }, [tab, draftHtml]);

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
      // The findings are a reading of the *saved* page, and a save is
      // exactly when they stop being true. Without this they sat on the
      // cache for thirty seconds and told you about a button you had
      // already fixed.
      void utils.agents.reviewShop.invalidate();
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
  // While picking, the canvas shows the starter being considered — the same
  // renderer, so a starter is judged as the page it would become.
  const shown = picking
    ? starters[highlight].draft
    : proposed === null
      ? draft
      : { ...draft, html: proposed };
  const path = `/shop/${shown.slug || slugify(shown.title) || "your-shop"}`;

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
            {picking ? "New shop" : draft.title || "New shop"}
            {picking ? null : (
              <StatusChip status={published ? "live" : "draft"} />
            )}
          </p>
          <p className="truncate text-[12px] text-(--dash-ash)">
            {picking
              ? "Start from one of these, or from nothing"
              : `${path} · ${
                  dirty ? "Unsaved changes" : saving ? "Saving…" : "Saved"
                }`}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {picking ? (
            <button
              type="button"
              className={dashButtonSecondary}
              onClick={() => setPicking(false)}
            >
              Start from nothing
            </button>
          ) : null}
          {!picking && published ? (
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
          {!picking && store ? (
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
          {picking ? null : (
            <button
              type="button"
              className={dashButtonPrimary}
              disabled={saving || !dirty}
              onClick={save}
            >
              {saving ? "Saving…" : store ? "Save" : "Create as draft"}
            </button>
          )}
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
          {picking ? (
            <StarterList
              highlight={highlight}
              onHighlight={setHighlight}
              onChoose={(chosen) => {
                setDraft(chosen);
                setPicking(false);
                setTab("page");
              }}
              onBlank={() => setPicking(false)}
            />
          ) : (
            <>
              <div className="shrink-0 border-b border-(--dash-line-solid) p-3">
                <Segmented
                  aria-label="What to edit"
                  value={tab}
                  onChange={setTab}
                  options={[
                    { value: "page", label: "Page" },
                    { value: "items", label: "Items" },
                    { value: "blocks", label: "Blocks" },
                    { value: "html", label: "HTML" },
                    { value: "look", label: "Look" },
                    { value: "agent", label: "Agent" },
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
                  ) : tab === "agent" ? (
                    <AgentPane
                      shopId={isNew ? null : id}
                      dirty={dirty}
                      onPreview={setProposed}
                      onApply={(html) => {
                        patch({ html });
                        setTab("blocks");
                      }}
                    />
                  ) : tab === "blocks" ? (
                    <BlockEditor
                      blocks={blocks}
                      onBlocks={writeBlocks}
                      shop={{ slug: draft.slug, title: draft.title }}
                      open={openBlock}
                      onOpen={setOpenBlock}
                    />
                  ) : (
                    <LookFields draft={draft} patch={patch} />
                  )}
                </div>
              )}
            </>
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

          <Canvas
            draft={shown}
            owner={username ?? "you"}
            device={device}
            drawn={drawn.length}
            edit={edit}
          />
        </section>
      </div>
    </div>
  );
}

/** The five shops a new one can start as, each judged on the canvas. */
function StarterList({
  highlight,
  onHighlight,
  onChoose,
  onBlank,
}: {
  highlight: number;
  onHighlight: (index: number) => void;
  onChoose: (draft: Draft) => void;
  onBlank: () => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <p className="text-[11px] font-semibold tracking-[0.14em] text-(--dash-ash) uppercase">
        Start from
      </p>
      <div className="mt-3 grid gap-2">
        {starters.map((starter, index) => {
          const chosen = index === highlight;
          const colours = palette(starter.draft.theme, starter.draft.accent);
          return (
            <div
              key={starter.id}
              className={`rounded-(--dash-radius) border transition-colors ${
                chosen
                  ? "border-(--dash-fg)"
                  : "border-(--dash-line) hover:border-(--dash-line-strong)"
              }`}
            >
              <button
                type="button"
                aria-pressed={chosen}
                onClick={() => onHighlight(index)}
                onDoubleClick={() => onChoose(starter.draft)}
                className={`flex w-full items-center gap-3 p-3 text-left ${dashFocus}`}
              >
                <span
                  aria-hidden="true"
                  className="grid size-10 shrink-0 place-items-center rounded-xl border"
                  style={{
                    background: colours.page,
                    borderColor: colours.line,
                  }}
                >
                  <span
                    className="block h-0.5 w-5 rounded-full"
                    style={{ background: colours.accent }}
                  />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {starter.name}
                  </span>
                  <span className="block truncate text-[13px] text-(--dash-ash)">
                    {starter.hint}
                  </span>
                </span>
              </button>
              {chosen ? (
                <div className="flex items-center justify-between gap-3 border-t border-(--dash-line) px-3 py-2">
                  <p className="text-[12px] text-(--dash-ash)">
                    {starter.draft.template} · {starter.draft.theme} ·{" "}
                    {starter.draft.lines.length} item
                    {starter.draft.lines.length === 1 ? "" : "s"}
                  </p>
                  <button
                    type="button"
                    className={dashButtonPrimary}
                    onClick={() => onChoose(starter.draft)}
                  >
                    Use this one
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onBlank}
        className={`mt-3 text-sm text-(--dash-ash) underline underline-offset-4 hover:text-(--dash-fg) ${dashFocus}`}
      >
        Start from an empty page instead
      </button>
      <p className="mt-4 text-sm text-(--dash-ash)">
        Every one of these is a draft like any other: pick the nearest, then
        change the parts that are not yours. Nothing is public until you publish
        it.
      </p>
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
  drawn,
  edit,
}: {
  draft: Draft;
  owner: string;
  device: Device;
  /** How many blocks on the left draw something, so the two counts can be
      checked against each other before anything here is made editable. */
  drawn: number;
  edit?: ShopHtmlEdit;
}) {
  const { clean } = useSanitised(draft.html);
  const shop = useMemo(
    () => toPreview(draft, owner, clean),
    [draft, owner, clean],
  );
  const width = WIDTH[device];

  // Editing on the page addresses a block by position, so the positions
  // have to agree. They can disagree — the sanitiser may drop an element
  // the author wrote — and editing the wrong block is worse than not being
  // able to edit here at all. So: count both, and only offer it when they
  // match. The "taken out" line on the HTML tab already says why.
  const aligned = useMemo(
    () =>
      clean.trim()
        ? toBlocks(clean).filter((b) => !rendersNothing(b)).length === drawn
        : false,
    [clean, drawn],
  );

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <div
        style={width ? { width, maxWidth: "100%" } : undefined}
        className="mx-auto overflow-hidden rounded-(--dash-radius) border border-(--dash-line-solid) shadow-sm"
      >
        <StorefrontPage shop={shop} preview edit={aligned ? edit : undefined} />
      </div>
      {edit && clean.trim() && !aligned ? (
        <p className="mx-auto mt-3 max-w-md text-center text-[12px] text-(--dash-ash)">
          The sanitiser changed this page, so editing it here would land on the
          wrong block. Edit it on the left; the HTML tab says what it took out.
        </p>
      ) : null}
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
  const { removed } = useSanitised(value);
  const colours = palette(removedFor.theme, removedFor.accent);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap gap-1 border-b border-(--dash-line-solid) p-2">
        {/* First, and on its own, because it is the only one of these that
            knows anything: the rest paste a shape, this one pastes an
            address that takes money. Typing that by hand is how a shop
            ends up with a button that goes nowhere. */}
        <PayLinkMenu
          shop={{ slug: removedFor.slug, title: removedFor.title }}
          onPick={(target) =>
            editor.current?.insert(payLinkHtml(target.href, target.label))
          }
          trigger={
            <>
              <LinkIcon className="size-3.5" aria-hidden />
              Pay link
            </>
          }
        />
        <span
          aria-hidden
          className="mx-1 my-auto h-5 w-px bg-(--dash-line-strong)"
        />
        {/* On shelves rather than in one row: twenty pills side by side
            is a wall to read, and the toolbar wrapped to three lines on a
            laptop. Same four groups as the block menu, so someone who
            learns one tab knows the other. */}
        {SNIPPET_GROUPS.map(({ group, items }) => (
          <DropdownMenu key={group}>
            <DropdownMenuTrigger
              // min-h-9: these measured 28px, the smallest targets in the app.
              className={`flex min-h-9 items-center gap-1 rounded-full border border-(--dash-line-strong) px-3 py-1 text-[12px] text-(--dash-fg) transition-colors hover:bg-(--dash-fg) hover:text-(--dash-surface) ${dashFocus}`}
            >
              {group}
              <ChevronDown className="size-3" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-64">
              {items.map((snippet) => (
                <DropdownMenuItem
                  key={snippet.label}
                  onClick={() => editor.current?.insert(snippet.body)}
                  className="grid gap-0.5"
                >
                  <span className="text-sm">{snippet.label}</span>
                  <span className="text-[12px] text-(--dash-ash)">
                    {snippet.hint}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
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
            {/* A tag is named in brackets; everything else the sanitiser
                reports is already a sentence and gets left alone. */}
            Taken out by the sanitiser:{" "}
            {removed
              .map((t) => (/^[a-z][a-z0-9-]*$/.test(t) ? `<${t}>` : t))
              .join(", ")}
          </p>
        ) : (
          <p className="text-[13px] text-(--dash-ash)">
            Write the page however you like: your own{" "}
            <code style={{ color: colours.accent }}>&lt;style&gt;</code>, your
            own classes, your own layout. It renders in a frame that cannot run
            anything and cannot reach the page around it, so what comes out are
            the things that frame would not stop — scripts, forms, other frames,
            and any stylesheet or image that would call a stranger. Web fonts
            from Google Fonts are allowed.
          </p>
        )}
        {/* Nothing is cut any more, so this says how far over rather than
            where the knife fell. The save refuses until it is under, and
            the page in the editor is still whole while you trim it. */}
        {value.length > MAX_HTML ? (
          <p className="mt-1 text-[12px] text-(--dash-err)" role="status">
            {(value.length - MAX_HTML).toLocaleString()} characters over the
            limit of {MAX_HTML.toLocaleString()} — nothing has been cut, but it
            will not save until it fits.
          </p>
        ) : (
          <p className="mt-1 text-[12px] text-(--dash-ash) tabular-nums">
            {value.length.toLocaleString()}/{MAX_HTML.toLocaleString()}
          </p>
        )}
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
