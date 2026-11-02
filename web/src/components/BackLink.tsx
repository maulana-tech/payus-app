"use client";

import { ChevronLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Goes back to the page before this one. It renders nothing when there is
 * no such page — opened in a new tab, or followed from a shared link — because
 * a Back that quietly goes somewhere else is worse than no Back at all.
 */
export function BackLink({
  label = "Back",
  className,
}: {
  label?: string;
  className?: string;
}) {
  // Decided after mount: the server has no history to look at, and reading
  // it during render would make the markup disagree with the browser.
  const [canGoBack, setCanGoBack] = useState(false);
  useEffect(() => {
    let sameOrigin = false;
    try {
      sameOrigin = new URL(document.referrer).origin === window.location.origin;
    } catch {
      sameOrigin = false;
    }
    setCanGoBack(sameOrigin && window.history.length > 1);
  }, []);

  if (!canGoBack) return null;

  return (
    <button
      type="button"
      onClick={() => window.history.back()}
      className={cn(
        "inline-flex h-9 items-center gap-1 rounded-full border border-(--dash-line-strong) pr-3.5 pl-2.5 text-[11px] font-semibold tracking-[0.08em] text-(--dash-fg) uppercase transition-colors hover:border-(--dash-fg) hover:bg-(--dash-fg) hover:text-(--dash-surface) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--dash-fg)",
        className,
      )}
    >
      <ChevronLeft className="size-4" aria-hidden="true" />
      {label}
    </button>
  );
}
