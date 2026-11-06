"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { DitherField } from "../landing/DitherField";

type DashboardMode = "light" | "dark";
const STORAGE_KEY = "payus.dashboard.mode";

// Both colours come from the same family as the page, so the field reads as
// paper grain rather than a pattern: the base is --dash-bg exactly (a base
// that misses by a shade turns the whole dither visible), and the second
// colour is the hairline tone. The blue that used to sit here contradicted
// the dashboard's own rule — marks are ink, never hue — and in dark mode it
// put a visible texture behind body text.
const DITHER = {
  light: { light: "#f5f3ea", dark: "#e3e1d5" },
  dark: { light: "#20261a", dark: "#2d3322" },
} as const;

// Runs before hydration so the saved (or system) mode paints without a flash.
const applyStoredMode = `try{var m=localStorage.getItem("${STORAGE_KEY}");if(m!=="light"&&m!=="dark")m=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.dashMode=m}catch(e){}`;

function readMode(): DashboardMode {
  return document.documentElement.dataset.dashMode === "dark"
    ? "dark"
    : "light";
}

export function DashboardBackground({
  children,
  compact = false,
  backdrop = true,
}: {
  children: ReactNode;
  /** Size to the content (embedded widgets) instead of filling the screen. */
  compact?: boolean;
  /**
   * Draw the dithered field behind the page. The canvas covers the whole
   * window with opaque surfaces, so it asks for no backdrop rather than
   * running a shader nobody can see.
   */
  backdrop?: boolean;
}) {
  const [mode, setMode] = useState<DashboardMode>("light");

  // Follow the toggle wherever it lives: it writes data-dash-mode on <html>.
  useEffect(() => {
    setMode(readMode());
    const observer = new MutationObserver(() => setMode(readMode()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-dash-mode"],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className={`theme-product dashboard-app relative isolate overflow-x-clip ${compact ? "" : "min-h-svh"}`}
    >
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static, no user input */}
      <script dangerouslySetInnerHTML={{ __html: applyStoredMode }} />
      {backdrop ? (
        <div aria-hidden="true" className="fixed inset-0 -z-10">
          <DitherField {...DITHER[mode]} />
        </div>
      ) : null}
      {children}
    </div>
  );
}

/**
 * The mode as the document currently has it. Unlike `useDashboardMode` this
 * holds no state of its own, so a component far from the toggle still
 * follows it — used by anything that has to be told a colour outright
 * (the grid) instead of inheriting one.
 */
export function useDashMode(): DashboardMode {
  return useSyncExternalStore(
    (onChange) => {
      const observer = new MutationObserver(onChange);
      observer.observe(document.documentElement, {
        attributeFilter: ["data-dash-mode"],
      });
      return () => observer.disconnect();
    },
    readMode,
    () => "light" as DashboardMode,
  );
}

export function useDashboardMode() {
  const [mode, setMode] = useState<DashboardMode>("light");

  useEffect(() => {
    setMode(readMode());
  }, []);

  const toggleMode = useCallback(() => {
    setMode((current) => {
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.dataset.dashMode = next;
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Private mode: the choice just won't persist.
      }
      return next;
    });
  }, []);

  return { mode, toggleMode };
}
