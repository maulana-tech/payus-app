"use client";

import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { publicDemo } from "@/lib/demo";
import { cn } from "@/lib/utils";
import { useSession } from "../../SessionProvider";
import { mono } from "./styles";

export const SECTIONS: { id: string; label: string; quiet?: boolean }[] = [
  { id: "rail", label: "The rail" },
  { id: "agents", label: "The agents" },
  // quiet: the section carries its own index, so the rail shows only its tick
  { id: "team", label: "The table", quiet: true },
  { id: "ways", label: "Ways to be paid" },
  { id: "terms", label: "The terms" },
  { id: "questions", label: "Questions" },
];

/** The one call to action on the page: into the app, however far along you are. */
export function Cta({ className }: { className?: string }) {
  const { authenticated, connecting, sessionReady, username, signIn } =
    useSession();
  // Sign-in lives behind a provider that has to load before it can do
  // anything. If it never does, say so — a button that silently does
  // nothing is worse than one that admits it cannot work.
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (sessionReady) return setStalled(false);
    const timer = setTimeout(() => setStalled(true), 8000);
    return () => clearTimeout(timer);
  }, [sessionReady]);
  const body = (
    <>
      {connecting
        ? "Signing in…"
        : // A generated sandbox name is not an identity anyone recognises,
          // so the public demo says what the button does instead.
          publicDemo()
          ? "Try the demo"
          : authenticated
            ? username
              ? `Open @${username}`
              : "Open the app"
            : "Get started"}
      <span className="flex size-6 items-center justify-center rounded-[2px] border border-ed-cream/30 transition-transform group-hover:translate-x-0.5">
        <ArrowRight className="size-3" aria-hidden="true" />
      </span>
    </>
  );
  const shell = cn(
    "group inline-flex items-center gap-4 rounded-[3px] border border-ed-cream/15 bg-ed-dark-2 py-2 pr-2 pl-4 text-ed-cream shadow-lg transition-colors hover:border-ed-cream/40 focus-visible:ring-2 focus-visible:ring-ed-cream/60 focus-visible:outline-none",
    mono,
    className,
  );
  if (authenticated)
    return (
      <Link href="/dashboard" className={shell}>
        {body}
      </Link>
    );

  return (
    <span className={cn("inline-grid gap-2", className && "justify-items-end")}>
      <button
        type="button"
        onClick={() => signIn()}
        className={shell}
        aria-describedby={stalled ? "sign-in-stalled" : undefined}
      >
        {body}
      </button>
      {stalled ? (
        <span
          id="sign-in-stalled"
          className={cn(mono, "max-w-64 text-ed-cream/50")}
        >
          Sign-in has not loaded. If this is your deployment, check
          NEXT_PUBLIC_PRIVY_APP_ID.
        </span>
      ) : null}
    </span>
  );
}

/**
 * The fixed hairline frame: a top bar with the mark and the call to action,
 * and a left rail whose index names the section you are in.
 */
export function Frame() {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) setActive(entry.target.id);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    for (const section of SECTIONS) {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <header className="pointer-events-none fixed inset-x-0 top-0 z-50 flex h-[64px] items-center justify-between border-b border-ed-cream/15 md:h-[80px]">
        <Link
          href="/"
          aria-label="Payus home"
          className="pointer-events-auto flex h-full w-[64px] items-center justify-center border-r border-ed-cream/15 md:w-[80px]"
        >
          <Image
            src="/assets/payus-white.svg"
            alt=""
            width={30}
            height={30}
            priority
          />
        </Link>
        <Cta className="pointer-events-auto mr-4 md:mr-8" />
      </header>
      <nav
        aria-label="Sections"
        className="pointer-events-none fixed top-[80px] bottom-0 left-0 z-50 hidden w-[80px] border-r border-ed-cream/15 mix-blend-difference md:block"
      >
        <ul className="absolute top-8 left-full space-y-3">
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="pointer-events-auto flex items-center gap-2.5 py-0.5"
              >
                <span
                  className={cn(
                    "h-px bg-white/60 transition-all duration-500",
                    active === section.id ? "w-4" : "w-2",
                  )}
                />
                <span
                  className={cn(
                    mono,
                    "whitespace-nowrap text-white transition-opacity duration-500",
                    active === section.id && !section.quiet
                      ? "opacity-90"
                      : "opacity-0",
                  )}
                >
                  {section.label}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
