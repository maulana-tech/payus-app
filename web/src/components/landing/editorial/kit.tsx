"use client";

import { motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { mono } from "./styles";

/** The mark that sits on every hairline corner. */
export function Star({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-[13px] leading-none text-ed-cream/80",
        className,
      )}
    >
      ✦
    </span>
  );
}

export function Reveal({
  children,
  className,
  delay = 0,
  margin = "-15% 0px",
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  margin?: `${number}px` | `${number}% 0px`;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin }}
      transition={{ duration: 0.9, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

export function Title({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    // leading last: tailwind-merge drops it when className overrides the size
    <h2
      className={cn(
        "font-(family-name:--font-landing-serif) text-[clamp(2.75rem,7vw,6.25rem)] font-light tracking-[-0.02em] whitespace-pre-line",
        className,
        "leading-[0.95]",
      )}
    >
      {children}
    </h2>
  );
}

/** A label chip, used beside a chapter's body. */
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span
      className={cn(
        mono,
        "shrink-0 self-start rounded-[3px] border border-ed-cream/25 bg-black/30 px-3 py-1.5 text-ed-cream/80",
      )}
    >
      {children}
    </span>
  );
}

/**
 * A full-bleed painting behind a section: the loop when motion is welcome,
 * its first frame when it is not.
 */
export function Film({
  name,
  poster = "jpg",
  dim = "from-black/70 via-black/30",
}: {
  name: string;
  poster?: "jpg" | "webp";
  dim?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <div className="absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
      {reduced ? (
        <Image
          src={`/landing/${name}.${poster}`}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
      ) : (
        <video
          className="h-full w-full object-cover"
          src={`/landing/${name}.mp4`}
          poster={`/landing/${name}.${poster}`}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
        />
      )}
      <div
        className={cn("absolute inset-0 bg-gradient-to-r to-transparent", dim)}
      />
    </div>
  );
}
