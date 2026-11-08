"use client";

import {
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  Link2,
  Plus,
  Trash2,
} from "lucide-react";

/** The shop being edited, as the pay-link menu needs to know it. */
type Shop = { slug: string; title: string };

import { type ReactNode, useId, useState } from "react";
import { PayLinkMenu } from "@/components/canvas/PayLinks";
import { dashFocus } from "@/components/dashboard/styles";
import {
  BLOCK_KINDS,
  type Block,
  type BlockKind,
  blankBlock,
  duplicateBlock,
  htmlShape,
  insertBlock,
  moveBlock,
  removeBlock,
  rendersNothing,
} from "@/features/storefront/blocks";
import { cn } from "@/lib/utils";

// The page, edited as a list of things rather than as markup.
//
// The HTML field is still the only thing stored: blocks are read out of it
// when this opens and written back on every change, so the HTML tab and
// this tab are two views of one value and cannot drift. A block this editor
// does not recognise — anything pasted by hand — is shown as itself and
// left alone, rather than flattened into fields that would lose it.

const label =
  "text-[11px] font-semibold tracking-[0.1em] text-(--dash-ash) uppercase";

const field =
  "w-full rounded-(--dash-radius-sm) border border-(--dash-line-strong) bg-(--dash-surface) px-2.5 py-2 text-sm text-(--dash-fg) outline-none focus:border-(--dash-fg)";

function Text({
  as = "input",
  name,
  value,
  onChange,
  rows = 3,
}: {
  as?: "input" | "textarea";
  name: string;
  value: string;
  onChange: (next: string) => void;
  rows?: number;
}) {
  const id = useId();
  return (
    <label className="grid gap-1" htmlFor={id}>
      <span className={label}>{name}</span>
      {as === "textarea" ? (
        <textarea
          id={id}
          rows={rows}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn(field, "resize-y leading-relaxed")}
        />
      ) : (
        <input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={field}
        />
      )}
    </label>
  );
}

/**
 * The items of a block that holds a list of them.
 *
 * One component rather than six, because every one of these blocks wants
 * the same three things — change an item, add one at the end, take one
 * out — and six copies of that is six places for "remove" to be wrong.
 * The last item cannot be removed: a block of nothing is a block that has
 * vanished from the page without anyone saying so.
 */
function Items<T>({
  items,
  onItems,
  blank,
  name,
  render,
}: {
  items: T[];
  onItems: (next: T[]) => void;
  blank: () => T;
  /** Singular, for the buttons: "question" gives "Add question". */
  name: string;
  render: (item: T, set: (next: T) => void) => ReactNode;
}) {
  const put = (at: number, next: T) =>
    onItems(items.map((item, where) => (where === at ? next : item)));
  return (
    <div className="grid min-w-0 gap-2">
      {items.map((item, at) => (
        <div
          // These items have no id of their own: they are read back out of
          // the page's markup, where position is the only thing that
          // identifies them.
          // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity here.
          key={at}
          className="grid min-w-0 gap-2 rounded-(--dash-radius-sm) border border-(--dash-line) p-2"
        >
          {render(item, (next) => put(at, next))}
          <div className="flex justify-end">
            <button
              type="button"
              disabled={items.length < 2}
              onClick={() => onItems(items.filter((_, w) => w !== at))}
              className={cn(
                "rounded-(--dash-radius-sm) px-2 py-1 text-[12px] text-(--dash-ash) hover:text-(--dash-err) disabled:cursor-not-allowed disabled:opacity-30",
                dashFocus,
              )}
            >
              Remove this {name}
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onItems([...items, blank()])}
        className={cn(
          "flex items-center gap-2 rounded-(--dash-radius-sm) border border-(--dash-line-strong) border-dashed px-2 py-2 text-[12px] text-(--dash-ash) hover:text-(--dash-fg)",
          dashFocus,
        )}
      >
        <Plus className="size-3.5" aria-hidden />
        Add {name}
      </button>
    </div>
  );
}

/** The address field, with the account's own pay links behind a button. */
function Address({
  value,
  onChange,
  shop,
  name = "Address (https)",
}: {
  value: string;
  onChange: (href: string) => void;
  shop?: Shop;
  name?: string;
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <Text name={name} value={value} onChange={onChange} />
      <div className="flex justify-end">
        <PayLinkMenu
          shop={shop}
          align="end"
          onPick={(target) => onChange(target.href)}
          trigger={
            <>
              <Link2 className="size-3.5" aria-hidden />
              Choose a pay link
            </>
          }
        />
      </div>
    </div>
  );
}

/** The fields one block has, and nothing else. */
function Fields({
  block,
  onChange,
  shop,
}: {
  block: Block;
  onChange: (next: Block) => void;
  shop?: Shop;
}) {
  switch (block.kind) {
    case "heading":
      return (
        <div className="grid gap-3">
          <Text
            name="Heading"
            value={block.text}
            onChange={(text) => onChange({ ...block, text })}
          />
          <label className="grid gap-1">
            <span className={label}>Size</span>
            <select
              value={block.level}
              onChange={(event) =>
                onChange({
                  ...block,
                  level: Number(event.target.value) === 3 ? 3 : 2,
                })
              }
              className={field}
            >
              <option value={2}>Section heading</option>
              <option value={3}>Smaller heading</option>
            </select>
          </label>
        </div>
      );
    case "text":
    case "lead":
    case "quiet":
    case "quote":
      return (
        <Text
          as="textarea"
          name={block.kind === "quote" ? "Quote" : "Text"}
          value={block.text}
          onChange={(text) => onChange({ ...block, text })}
        />
      );
    case "list":
      return (
        <div className="grid gap-3">
          <Text
            as="textarea"
            name="One per line"
            rows={4}
            value={block.items.join("\n")}
            onChange={(next) =>
              onChange({
                ...block,
                // Blank lines are someone pressing return, not an item.
                items: next.split("\n").filter((line) => line.trim()),
              })
            }
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={block.ordered}
              onChange={(event) =>
                onChange({ ...block, ordered: event.target.checked })
              }
            />
            Numbered
          </label>
        </div>
      );
    case "card":
      return (
        <div className="grid gap-3">
          <Text
            name="Title"
            value={block.title}
            onChange={(title) => onChange({ ...block, title })}
          />
          <Text
            as="textarea"
            name="Text"
            value={block.text}
            onChange={(text) => onChange({ ...block, text })}
          />
        </div>
      );
    case "columns":
      return (
        <div className="grid gap-4">
          {(["left", "right"] as const).map((side) => (
            <div key={side} className="grid gap-3">
              <p className={label}>{side === "left" ? "First" : "Second"}</p>
              <Text
                name="Title"
                value={block[side].title}
                onChange={(title) =>
                  onChange({ ...block, [side]: { ...block[side], title } })
                }
              />
              <Text
                as="textarea"
                name="Text"
                rows={2}
                value={block[side].text}
                onChange={(text) =>
                  onChange({ ...block, [side]: { ...block[side], text } })
                }
              />
            </div>
          ))}
        </div>
      );
    case "image":
      return (
        <div className="grid gap-3">
          <Text
            name="Address (https)"
            value={block.src}
            onChange={(src) => onChange({ ...block, src })}
          />
          <Text
            name="Described for a screen reader"
            value={block.alt}
            onChange={(alt) => onChange({ ...block, alt })}
          />
          <Text
            name="Caption"
            value={block.caption}
            onChange={(caption) => onChange({ ...block, caption })}
          />
        </div>
      );
    case "link":
    case "cta":
      return (
        <div className="grid gap-3">
          <Text
            name={block.kind === "cta" ? "Button" : "Words"}
            value={block.text}
            onChange={(text) => onChange({ ...block, text })}
          />
          <Address
            value={block.href}
            onChange={(href) => onChange({ ...block, href })}
            shop={shop}
          />
          {block.kind === "cta" ? (
            <p className="text-[12px] text-(--dash-ash)">
              Choose one of your own pay links above, or paste any https
              address. It opens in a new tab.
            </p>
          ) : null}
        </div>
      );
    case "divider":
      return (
        <p className="text-sm text-(--dash-ash)">A rule across the page.</p>
      );
    case "buttons":
      return (
        <Items
          items={block.items}
          onItems={(items) => onChange({ ...block, items })}
          blank={() => ({ href: "https://example.com/pay", text: "Buy now" })}
          name="button"
          render={(item, set) => (
            <>
              <Text
                name="Words on it"
                value={item.text}
                onChange={(text) => set({ ...item, text })}
              />
              <Address
                value={item.href}
                onChange={(href) => set({ ...item, href })}
                shop={shop}
              />
            </>
          )}
        />
      );
    case "faq":
      return (
        <Items
          items={block.items}
          onItems={(items) => onChange({ ...block, items })}
          blank={() => ({ q: "Another question?", a: "And its answer." })}
          name="question"
          render={(item, set) => (
            <>
              <Text
                name="Question"
                value={item.q}
                onChange={(q) => set({ ...item, q })}
              />
              <Text
                as="textarea"
                rows={2}
                name="Answer"
                value={item.a}
                onChange={(a) => set({ ...item, a })}
              />
            </>
          )}
        />
      );
    case "steps":
      return (
        <Items
          items={block.items}
          onItems={(items) => onChange({ ...block, items })}
          blank={() => ({ title: "Then this", text: "And what happens." })}
          name="step"
          render={(item, set) => (
            <>
              <Text
                name="Step"
                value={item.title}
                onChange={(title) => set({ ...item, title })}
              />
              <Text
                as="textarea"
                rows={2}
                name="What happens"
                value={item.text}
                onChange={(text) => set({ ...item, text })}
              />
            </>
          )}
        />
      );
    case "stats":
      return (
        <Items
          items={block.items}
          onItems={(items) => onChange({ ...block, items })}
          blank={() => ({ figure: "0", label: "What it counts" })}
          name="figure"
          render={(item, set) => (
            <>
              <Text
                name="Figure"
                value={item.figure}
                onChange={(figure) => set({ ...item, figure })}
              />
              <Text
                name="What it counts"
                value={item.label}
                onChange={(label) => set({ ...item, label })}
              />
            </>
          )}
        />
      );
    case "gallery":
      return (
        <Items
          items={block.items}
          onItems={(items) => onChange({ ...block, items })}
          blank={() => ({ src: "https://example.com/photo.jpg", alt: "" })}
          name="image"
          render={(item, set) => (
            <>
              <Text
                name="Address (https)"
                value={item.src}
                onChange={(src) => set({ ...item, src })}
              />
              <Text
                name="What it shows"
                value={item.alt}
                onChange={(alt) => set({ ...item, alt })}
              />
            </>
          )}
        />
      );
    case "table":
      return (
        <div className="grid gap-3">
          <Text
            name="Headings, one per line"
            as="textarea"
            rows={2}
            value={block.head.join("\n")}
            onChange={(value) =>
              onChange({ ...block, head: value.split("\n") })
            }
          />
          <Text
            name="Rows — one per line, cells split by |"
            as="textarea"
            rows={4}
            value={block.rows.map((row) => row.join(" | ")).join("\n")}
            onChange={(value) =>
              onChange({
                ...block,
                rows: value
                  .split("\n")
                  .map((row) => row.split("|").map((cell) => cell.trim())),
              })
            }
          />
          <p className="text-[12px] text-(--dash-ash)">
            A row with fewer cells than there are headings simply ends early.
          </p>
        </div>
      );
    case "note":
      return (
        <Text
          as="textarea"
          name="Note"
          value={block.text}
          onChange={(text) => onChange({ ...block, text })}
        />
      );
    case "spacer":
      return (
        <label className="grid gap-1">
          <span className={label}>How much</span>
          <select
            value={block.size}
            onChange={(event) =>
              onChange({
                ...block,
                size: event.target.value as "sm" | "md" | "lg",
              })
            }
            className={field}
          >
            <option value="sm">A little</option>
            <option value="md">Some</option>
            <option value="lg">A lot</option>
          </select>
        </label>
      );
    case "html":
      return (
        <div className="grid gap-2">
          <Text
            as="textarea"
            name="Markup"
            rows={5}
            value={block.html}
            onChange={(html) => onChange({ ...block, html })}
          />
          <p className="text-[12px] text-(--dash-ash)">
            {rendersNothing(block)
              ? why(block.html)
              : "Written by hand, so it is kept exactly as it is. The sanitiser still has the last word on it."}
          </p>
        </div>
      );
  }
}

/**
 * Why a block draws nothing — three different answers, and the author is
 * owed the right one. A `<style>` is doing its job invisibly; a `<meta>` was
 * never going to appear; a `<script>` was written to run and will not.
 */
function why(html: string): string {
  if (/^\s*<script\b/i.test(html))
    return "A script, and nothing in the shop's frame may run — this is dropped before the page is served. The design is safe; the behaviour is not there.";
  if (/^\s*<(style|link)\b/i.test(html))
    return "Part of the design rather than part of the page: it styles what is below it and has nothing of its own to show.";
  return "Document scaffolding. A shop page is served inside Payus, so this is dropped and nothing on the page changes.";
}

const NAME: Record<BlockKind, string> = {
  ...Object.fromEntries(BLOCK_KINDS.map((k) => [k.kind, k.label])),
  html: "Your own markup",
} as Record<BlockKind, string>;

/**
 * What to call one row.
 *
 * A pasted page arrives with a `<meta>`, a `<title>`, three `<link>`s and a
 * `<script>` in front of the design, and every one of them came back as
 * "Your own markup" — six identical rows naming nothing, for six things
 * that are not on the page at all. A row has to say which it is.
 */
const nameFor = (block: Block): string =>
  block.kind === "html" && rendersNothing(block)
    ? "Not on the page"
    : (NAME[block.kind] ?? block.kind);

/**
 * The list, controlled.
 *
 * The blocks live in the canvas rather than here, because the page on the
 * right edits them too: a click in the preview opens a row in this panel,
 * and typing there writes back to the same list. Two copies of it would be
 * two answers to "what is on the page".
 */
export function BlockEditor({
  blocks,
  onBlocks,
  open,
  onOpen,
  shop,
}: {
  blocks: Block[];
  onBlocks: (next: Block[]) => void;
  /** This shop, so a pay-link menu can offer its own address first. */
  shop?: Shop;
  /** The row whose fields are showing, by block id. */
  open: string | null;
  onOpen: (id: string | null) => void;
}) {
  const [adding, setAdding] = useState(false);
  const commit = onBlocks;

  // A page that is all hand-written markup is one this list cannot do much
  // for: every row is an element, not a heading or a paragraph. Saying so
  // is better than letting someone conclude the editor is broken — which is
  // what a column of identical rows looks like.
  const drawn = blocks.filter((block) => !rendersNothing(block));
  const handWritten =
    drawn.length > 0 && drawn.every((block) => block.kind === "html");

  const add = (kind: BlockKind) => {
    const block = blankBlock(kind);
    commit(insertBlock(blocks, blocks.length, block));
    onOpen(block.id);
    setAdding(false);
  };

  return (
    // `min-w-0` down the whole chain: a grid item defaults to its
    // min-content width, and `truncate` is `white-space: nowrap`, whose
    // min-content width is the entire untruncated string. Without it a long
    // first line pushes every row past the panel and takes the move and
    // delete controls off the edge with it.
    <div className="grid min-w-0 gap-3">
      {blocks.length === 0 ? (
        <p className="rounded-(--dash-radius-sm) border border-dashed border-(--dash-line-strong) p-4 text-sm text-(--dash-ash)">
          Nothing on the page yet. Add a block and it appears on the right as
          you type.
        </p>
      ) : null}

      {handWritten ? (
        <p className="rounded-(--dash-radius-sm) border border-dashed border-(--dash-line-strong) p-3 text-[12px] text-(--dash-ash)">
          This page was written by hand, so it arrives here as the few elements
          it is made of rather than as headings and paragraphs — a design is
          kept whole instead of being chopped into fields that would lose it. To
          change the words,{" "}
          <span className="text-(--dash-fg)">
            click them on the page to the right and type
          </span>
          ; the HTML tab is where the markup itself is edited.
        </p>
      ) : null}

      <ol className="grid min-w-0 gap-2">
        {blocks.map((block, index) => {
          const shown = open === block.id;
          // A block that draws nothing is still the author's and still
          // theirs to move or delete — it just must not read like content.
          const inert = block.kind === "html" && rendersNothing(block);
          const name = nameFor(block);
          return (
            <li
              key={block.id}
              ref={(node) => {
                // Selected from the page on the right: bring the row to
                // where the person is already looking.
                if (shown && node) node.scrollIntoView({ block: "nearest" });
              }}
              className="min-w-0 rounded-(--dash-radius-sm) border border-(--dash-line-strong) bg-(--dash-surface)"
            >
              <div className="flex min-w-0 items-center gap-1 p-2">
                <button
                  type="button"
                  onClick={() => onOpen(shown ? null : block.id)}
                  aria-expanded={shown}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2 rounded-(--dash-radius-sm) px-1 py-1 text-left",
                    dashFocus,
                  )}
                >
                  {block.kind === "html" ? (
                    <Code2
                      className="size-3.5 shrink-0 text-(--dash-ash)"
                      aria-hidden
                    />
                  ) : null}
                  <span
                    className={cn(
                      "text-sm",
                      inert
                        ? "text-(--dash-ash)"
                        : "font-medium text-(--dash-fg)",
                    )}
                  >
                    {name}
                  </span>
                  <span className="min-w-0 truncate text-[12px] text-(--dash-ash)">
                    {summarise(block)}
                  </span>
                </button>

                <Control
                  icon={ChevronUp}
                  name={`Move ${name} up`}
                  disabled={index === 0}
                  onClick={() => commit(moveBlock(blocks, index, index - 1))}
                />
                <Control
                  icon={ChevronDown}
                  name={`Move ${name} down`}
                  disabled={index === blocks.length - 1}
                  onClick={() => commit(moveBlock(blocks, index, index + 1))}
                />
                <Control
                  icon={Copy}
                  name={`Duplicate ${name}`}
                  onClick={() => commit(duplicateBlock(blocks, index))}
                />
                <Control
                  icon={Trash2}
                  name={`Delete ${name}`}
                  destructive
                  onClick={() => commit(removeBlock(blocks, index))}
                />
              </div>

              {shown ? (
                <div className="border-t border-(--dash-line) p-3">
                  <Fields
                    block={block}
                    shop={shop}
                    onChange={(next) =>
                      commit(blocks.map((b) => (b.id === next.id ? next : b)))
                    }
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      {adding ? (
        <div className="grid gap-1 rounded-(--dash-radius-sm) border border-(--dash-line-strong) p-2">
          {BLOCK_KINDS.map((kind) => (
            <button
              key={kind.kind}
              type="button"
              onClick={() => add(kind.kind)}
              className={cn(
                "flex items-baseline gap-2 rounded-(--dash-radius-sm) px-2 py-2 text-left hover:bg-(--dash-tint)",
                dashFocus,
              )}
            >
              <span className="text-sm font-medium">{kind.label}</span>
              <span className="text-[12px] text-(--dash-ash)">{kind.hint}</span>
            </button>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setAdding((was) => !was)}
        aria-expanded={adding}
        className={cn(
          "flex min-h-10 items-center justify-center gap-2 rounded-(--dash-radius-sm) border border-dashed border-(--dash-line-strong) text-sm transition-colors hover:bg-(--dash-tint)",
          dashFocus,
        )}
      >
        <Plus className="size-4" aria-hidden />
        {adding ? "Close" : "Add a block"}
      </button>
    </div>
  );
}

function Control({
  icon: Icon,
  name,
  onClick,
  disabled,
  destructive,
}: {
  icon: typeof ChevronUp;
  name: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={name}
      title={name}
      className={cn(
        "shrink-0 rounded-(--dash-radius-sm) p-1.5 text-(--dash-ash) transition-colors",
        destructive ? "hover:text-(--dash-err)" : "hover:text-(--dash-fg)",
        "disabled:cursor-not-allowed disabled:opacity-30",
        dashFocus,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
    </button>
  );
}

/** Enough of the block to recognise it in a closed row. */
function summarise(block: Block): string {
  switch (block.kind) {
    case "heading":
    case "text":
    case "lead":
    case "quiet":
    case "quote":
      return block.text;
    case "card":
      return block.title;
    case "columns":
      return `${block.left.title} · ${block.right.title}`;
    case "list":
      return block.items.join(", ");
    case "link":
    case "cta":
      return block.text;
    case "image":
      return block.caption || block.alt || block.src;
    case "buttons":
      return block.items.map((item) => item.text).join(" · ");
    case "faq":
      return block.items.map((item) => item.q).join(" · ");
    case "steps":
      return block.items.map((item) => item.title).join(" · ");
    case "stats":
      return block.items.map((item) => item.figure).join(" · ");
    case "gallery":
      return `${block.items.length} images`;
    case "table":
      return block.head.join(" · ");
    case "note":
      return block.text;
    case "spacer":
      return { sm: "A little", md: "Some", lg: "A lot" }[block.size];
    case "divider":
      return "";
    case "html":
      return htmlShape(block.html);
  }
}
