"use client";

import { type RefObject, useEffect, useState } from "react";

/**
 * Tracks `prefers-reduced-motion`. Starts false so the server render and the
 * first client render agree; demos that auto-play check it before starting.
 */
export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(query.matches);
    const onChange = () => setReduce(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduce;
}

/** Whether `ref` is on screen, so demo timers only run while someone can see them. */
export function useInView(ref: RefObject<Element | null>): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) =>
      setInView(entry.isIntersecting),
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return inView;
}

/**
 * Roving focus for tab lists (WAI-ARIA tabs): the index a key moves to, or
 * null when the key isn't one tabs handle. Arrows wrap; Home/End jump.
 */
export function nextTabIndex(
  key: string,
  index: number,
  count: number,
): number | null {
  const last = count - 1;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return index === last ? 0 : index + 1;
    case "ArrowLeft":
    case "ArrowUp":
      return index === 0 ? last : index - 1;
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return null;
  }
}
