"use client";

import {
  ExternalLink,
  EyeOff,
  Globe,
  Link2,
  PenLine,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type CSSProperties, useState } from "react";
import { Input } from "@/components/ui/input";
import type { RouterOutputs } from "@/server/root";
import { trpc } from "@/trpc/react";
import { dashButtonPrimary, dashButtonSecondary } from "../styles";
import { Field } from "./InvoicesScreen";
import {
  EmptyState,
  ErrorNote,
  Ledger,
  ListRow,
  Panel,
  RowMenu,
  RowMenuItem,
  RowMenuSeparator,
  StatusChip,
} from "./kit";

// The list of shops. Editing one happens on its own page — `/canvas/[id]` —
// because a page is what is being written, and a dialog is the wrong size
// for that.

type Store = RouterOutputs["storefront"]["mine"][number];

const origin = () =>
  typeof window === "undefined" ? "" : window.location.origin;

export function StorefrontScreen() {
  return (
    <div className="grid gap-4">
      {/* The list comes first: it is the subject of the page, and it gives
          "Describe it instead" something to be instead of. */}
      <Panel
        title="Your shops"
        hint="Published shops are live at their address; a draft is yours alone until you publish it."
        action={
          <Link href="/canvas/new" className={dashButtonPrimary}>
            <Plus aria-hidden="true" />
            New shop
          </Link>
        }
      >
        <StoreList />
      </Panel>

      <DescribeIt />
    </div>
  );
}

function StoreList() {
  const stores = trpc.storefront.mine.useQuery();

  if (stores.isLoading)
    return (
      <div className="px-5 py-12 text-center text-sm text-(--dash-ash)">
        Loading…
      </div>
    );

  if ((stores.data ?? []).length === 0)
    return (
      <EmptyState
        title="No shop yet"
        action={
          <Link href="/canvas/new" className={dashButtonSecondary}>
            Open one
          </Link>
        }
      >
        Put a few things on a page and send the address. Each one is paid the
        same way an invoice is, and lands in the same ledger.
      </EmptyState>
    );

  return (
    <Ledger
      className="border-0 border-t border-(--dash-line-solid)"
      style={{ "--row-actions": "14rem" } as CSSProperties}
    >
      {stores.data?.map((store) => (
        <StoreRow key={store.id} store={store} />
      ))}
    </Ledger>
  );
}

/**
 * The Builder: a description in, a draft out. What comes back opens on the
 * canvas rather than going live, because putting a price in front of the
 * public is the owner's decision and not the model's.
 */
function DescribeIt() {
  const router = useRouter();
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
      router.push(`/canvas/${result.storefront.id}`);
    },
    onError: () => setNote(null),
  });

  if (status.data && !status.data.configured) return null;

  return (
    <Panel
      title="Describe it instead"
      hint="Say what you sell and the Builder writes the draft: the items, and a page built from the same blocks you would have used — so every line of it is yours to edit afterwards."
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

function StoreRow({ store }: { store: Store }) {
  const utils = trpc.useUtils();
  const publish = trpc.storefront.setPublished.useMutation({
    onSuccess: () => void utils.storefront.mine.invalidate(),
  });
  const path = `/shop/${store.slug}`;
  const published = store.state === "published";
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
            <span className="font-medium">{store.title}</span>
            <StatusChip status={published ? "live" : "draft"} />
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
        // The canvas is what a shop is for; everything else is one menu,
        // the same shape the other list screens use.
        actions={
          <>
            <Link href={`/canvas/${store.id}`} className={dashButtonSecondary}>
              <PenLine aria-hidden="true" />
              Open canvas
            </Link>
            <RowMenu label={`More for ${store.title}`}>
              {published ? (
                <RowMenuItem icon={Link2} onClick={() => void copyLink()}>
                  {copied ? "Link copied" : "Copy the shop's address"}
                </RowMenuItem>
              ) : null}
              {published ? (
                <RowMenuItem
                  icon={ExternalLink}
                  onClick={() => window.open(path, "_blank", "noreferrer")}
                >
                  Open the shop page
                </RowMenuItem>
              ) : null}
              {published ? <RowMenuSeparator /> : null}
              <RowMenuItem
                icon={published ? EyeOff : Globe}
                disabled={publish.isPending}
                onClick={() =>
                  publish.mutate({ id: store.id, published: !published })
                }
              >
                {published
                  ? "Take it off the web"
                  : "Publish it at this address"}
              </RowMenuItem>
            </RowMenu>
          </>
        }
      />
      {publish.error ? <ErrorNote>{publish.error.message}</ErrorNote> : null}
    </div>
  );
}
