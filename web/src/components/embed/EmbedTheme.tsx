"use client";

import { useEffect } from "react";

/** Applies `?theme=light|dark` from the embed snippet for this frame only. */
export function EmbedTheme({ theme }: { theme?: string }) {
  useEffect(() => {
    if (theme === "light" || theme === "dark")
      document.documentElement.dataset.dashMode = theme;
  }, [theme]);
  return null;
}
