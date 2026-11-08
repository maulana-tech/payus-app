"use client";

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { dashFocus } from "@/components/dashboard/styles";
import { useSession } from "@/components/SessionProvider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatMinor } from "@/features/invoices/money";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc/react";

// Somewhere on this page there has to be a way to be paid, and typing the
// address by hand is how that goes wrong: a slug misremembered, a username
// with the @ still on it, an address for a link that was archived last
// week. So the editor offers the ones that exist.
//
// It reads the owner's own links and shops and nothing else. A pay address
// is never composed from something typed into this editor — every target
// below is one this account already has.

export type PayTarget = {
  href: string;
  /** What the button would say if you inserted it as it is. */
  label: string;
  /** The address, or the amount, shown under the label in the menu. */
  hint: string;
  group: "This shop" | "Pay links" | "Your other shops" | "Your profile";
};

/**
 * Every address of this account's that takes money, as one list.
 *
 * `origin` comes from the browser rather than from a setting, so a link
 * inserted while developing points at the development server and one
 * inserted in production points at production — which is what makes the
 * preview on the right actually clickable.
 */
export function usePayTargets(shop?: { slug: string; title: string }): {
  targets: PayTarget[];
  loading: boolean;
} {
  const { username } = useSession();
  const links = trpc.paymentLinks.mine.useQuery();
  const shops = trpc.storefront.mine.useQuery();

  return useMemo(() => {
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    const out: PayTarget[] = [];

    if (shop?.slug.trim())
      out.push({
        href: `${origin}/shop/${shop.slug}`,
        label: shop.title.trim() || "This shop",
        hint: `/shop/${shop.slug}`,
        group: "This shop",
      });

    for (const link of links.data ?? []) {
      if (link.state === "archived") continue;
      out.push({
        href: `${origin}/pay/${username ?? ""}/${link.slug}`,
        label: link.title,
        hint: link.amountMinor
          ? formatMinor(BigInt(link.amountMinor), link.currency)
          : "The payer names the amount",
        group: "Pay links",
      });
    }

    for (const other of shops.data ?? []) {
      if (other.slug === shop?.slug) continue;
      out.push({
        href: `${origin}/shop/${other.slug}`,
        label: other.title,
        hint: other.state === "published" ? `/shop/${other.slug}` : "Draft",
        group: "Your other shops",
      });
    }

    if (username)
      out.push({
        href: `${origin}/pay/${username}`,
        label: `Pay @${username}`,
        hint: "Your profile — the payer names the amount",
        group: "Your profile",
      });

    return { targets: out, loading: links.isLoading || shops.isLoading };
  }, [
    links.data,
    links.isLoading,
    shops.data,
    shops.isLoading,
    shop,
    username,
  ]);
}

const GROUPS: PayTarget["group"][] = [
  "This shop",
  "Pay links",
  "Your other shops",
  "Your profile",
];

/**
 * The menu itself.
 *
 * An archived link is left out rather than shown and refused: the list is
 * meant to be a list of addresses that work.
 */
export function PayLinkMenu({
  shop,
  onPick,
  trigger,
  align = "start",
}: {
  shop?: { slug: string; title: string };
  onPick: (target: PayTarget) => void;
  trigger: ReactNode;
  align?: "start" | "end";
}) {
  const { targets, loading } = usePayTargets(shop);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] transition-colors",
          "border-(--dash-accent,var(--dash-line-strong)) text-(--dash-fg) hover:bg-(--dash-fg) hover:text-(--dash-surface)",
          dashFocus,
        )}
      >
        {trigger}
        <ChevronDown className="size-3" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="max-h-80 min-w-72">
        {targets.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-(--dash-ash)">
            {loading
              ? "Looking for your links…"
              : "No pay links yet. Make one under Links and it appears here."}
          </p>
        ) : null}
        {GROUPS.map((group) => {
          const mine = targets.filter((target) => target.group === group);
          if (mine.length === 0) return null;
          return (
            <DropdownMenuGroup key={group}>
              {group === GROUPS[0] ? null : <DropdownMenuSeparator />}
              <DropdownMenuLabel>{group}</DropdownMenuLabel>
              {mine.map((target) => (
                <DropdownMenuItem
                  key={target.href}
                  onClick={() => onPick(target)}
                  className="grid gap-0.5"
                >
                  <span className="truncate text-sm">{target.label}</span>
                  <span className="truncate text-[12px] text-(--dash-ash)">
                    {target.hint}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
