"use client";

import { useEmbedBridge } from "@/features/embed/bridge";

/**
 * Announces an embedded page to the site that framed it and keeps the
 * iframe sized to the content. `public/embed.js` documents these events;
 * without this component mounted they were never sent.
 */
export function EmbedBridge() {
  useEmbedBridge(true);
  return null;
}
