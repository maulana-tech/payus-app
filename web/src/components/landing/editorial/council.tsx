"use client";

import { useLenis } from "lenis/react";
import {
  AnimatePresence,
  type MotionValue,
  motion,
  useMotionTemplate,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
import Image from "next/image";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import { LIVE_SEATS, type Seat, TABLE } from "./agents";
import { Reveal, Star, Tag, Title } from "./kit";
import { mono } from "./styles";

// The table: the team as one long painting. The section pins while you
// scroll; each step pans the camera to one seat, lights it, and opens its
// card. Scroll is the only driver — the index below merely scrolls to a
// step — so the camera and the card can never disagree.

const ART = {
  poster: "/landing/council.webp",
  film: "/landing/council.mp4",
  w: 1600,
  h: 942,
};
const N = TABLE.length;
const STEP_VH = 55; // scroll per seat, and for the opening view
const SPRING = { stiffness: 55, damping: 20, mass: 1 };

const pad = (n: number) => String(n).padStart(2, "0");
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

type View = { x: number; y: number; s: number; bw: number; bh: number };

/** Where the painting sits: covering the stage, and on a step zoomed to a face. */
function frame(w: number, h: number, focus: Seat | null): View {
  const bw = Math.max(w, (h * ART.w) / ART.h);
  const bh = (bw * ART.h) / ART.w;
  if (!focus) return { x: (w - bw) / 2, y: (h - bh) / 2, s: 1, bw, bh };
  const wide = w >= 768;
  const s = wide ? 1.4 : 1.1;
  const [fx, fy] = focus.head;
  // the face goes on the side away from the card
  const tx = wide ? (fx < 50 ? 0.34 : 0.66) * w : 0.5 * w;
  const ty = (wide ? 0.42 : 0.3) * h;
  return {
    x: clamp(tx - (fx / 100) * bw * s, w - bw * s, 0),
    y: clamp(ty - ((fy + 6) / 100) * bh * s, h - bh * s, 0),
    s,
    bw,
    bh,
  };
}

/** A marker is shown only where it can be read: not under the bar or rail. */
function markerFits(seat: Seat, v: View, w: number) {
  const wide = w >= 768;
  const x = v.x + (seat.head[0] / 100) * v.bw * v.s;
  const y = v.y + ((seat.head[1] - 7) / 100) * v.bh * v.s;
  return x > (wide ? 80 : 0) + 36 && x < w - 36 && y - 24 > (wide ? 80 : 64);
}

export function Council() {
  const reduced = useReducedMotion() ?? false;
  const lenis = useLenis();
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [step, setStep] = useState(-1); // -1: the whole table

  useLayoutEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const measure = () =>
      setSize({ w: element.clientWidth, h: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end end"],
  });
  useMotionValueEvent(scrollYProgress, "change", (p) =>
    setStep(Math.min(N - 1, Math.floor(p * (N + 1)) - 1)),
  );

  const seat = step >= 0 ? TABLE[step] : null;
  const view = useMemo(
    () => (size ? frame(size.w, size.h, seat) : null),
    [size, seat],
  );

  // camera and spotlight as springs, so every move is one continuous pan
  const x = useSpring(0, SPRING);
  const y = useSpring(0, SPRING);
  const s = useSpring(1, SPRING);
  const sx = useSpring(50, SPRING);
  const sy = useSpring(40, SPRING);
  const dim = useSpring(0, { stiffness: 80, damping: 24 });
  const inverse = useTransform(s, (v) => 1 / v);
  const spot = useMotionTemplate`radial-gradient(ellipse 10% 26% at ${sx}% ${sy}%, rgba(12,14,9,0) 0%, rgba(12,14,9,0) 40%, rgba(12,14,9,0.76) 100%)`;
  const placed = useRef(false);

  useEffect(() => {
    if (!view) return;
    const put = (value: MotionValue<number>, to: number) =>
      reduced || !placed.current ? value.jump(to) : value.set(to);
    put(x, view.x);
    put(y, view.y);
    put(s, view.s);
    if (seat) {
      put(sx, seat.head[0]);
      put(sy, seat.head[1] + 5);
    }
    put(dim, seat ? 1 : 0);
    placed.current = true;
  }, [view, seat, reduced, x, y, s, sx, sy, dim]);

  const side =
    view &&
    seat &&
    size &&
    view.x + (seat.head[0] / 100) * view.bw * view.s > size.w / 2
      ? "left"
      : "right";

  /** Scroll to the middle of seat i's step. */
  const go = (i: number) => {
    const section = sectionRef.current;
    const stage = stageRef.current;
    if (!section || !stage) return;
    const top = section.getBoundingClientRect().top + window.scrollY;
    const target =
      top + ((section.offsetHeight - stage.offsetHeight) * (i + 1.5)) / (N + 1);
    if (lenis) lenis.scrollTo(target, { duration: reduced ? 0 : 1.4 });
    else
      window.scrollTo({ top: target, behavior: reduced ? "auto" : "smooth" });
  };

  const layer = view && { x, y, scale: s, width: view.bw, height: view.bh };

  return (
    <section
      id="team"
      ref={sectionRef}
      className="relative bg-ed-dark-2 text-ed-cream"
      style={{ height: `calc(100svh + ${(N + 1) * STEP_VH}svh)` }}
    >
      <div ref={stageRef} className="sticky top-0 h-svh overflow-hidden">
        {layer && (
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute top-0 left-0 origin-top-left will-change-transform"
            style={layer}
          >
            {reduced ? (
              <Image
                src={ART.poster}
                alt=""
                fill
                sizes="100vw"
                draggable={false}
                className="select-none object-cover"
              />
            ) : (
              <video
                src={ART.film}
                poster={ART.poster}
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                className="h-full w-full object-cover"
              />
            )}
            <motion.div
              className="absolute inset-0"
              style={{ background: spot, opacity: dim }}
            />
          </motion.div>
        )}

        {/* legibility: bands behind the bar and the index, and the opening fade */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/45 via-transparent via-30% to-black/70" />
        <motion.div
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/70 via-black/25 to-transparent"
          animate={{ opacity: seat ? 0 : 1 }}
          transition={{ duration: reduced ? 0 : 0.8 }}
        />

        {/* who sits where: a marker over each face, moving with the painting */}
        {layer && (
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute top-0 left-0 origin-top-left"
            style={layer}
          >
            {TABLE.map((member, i) => {
              const on = step === i;
              const fits = !!view && !!size && markerFits(member, view, size.w);
              return (
                <motion.span
                  key={member.id}
                  className={cn(
                    "absolute flex origin-bottom -translate-x-1/2 -translate-y-full transition-opacity duration-500",
                    !fits && "opacity-0",
                  )}
                  style={{
                    left: `${member.head[0]}%`,
                    top: `${member.head[1] - 7}%`,
                    scale: inverse,
                  }}
                >
                  <span
                    className={cn(
                      mono,
                      "flex items-center gap-1.5 rounded-[3px] border px-2 py-1 whitespace-nowrap backdrop-blur-sm transition-colors duration-500",
                      on
                        ? "border-ed-cream/60 bg-ed-dark-2/80 text-ed-cream"
                        : "border-ed-cream/15 bg-black/35 text-ed-cream/60",
                    )}
                  >
                    <span>✦</span>
                    {on ? member.name : pad(i + 1)}
                  </span>
                </motion.span>
              );
            })}
          </motion.div>
        )}

        {/* the opening view, titled like the chapters above it */}
        <motion.div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 pb-12 md:left-[80px] md:pb-24"
          animate={{ opacity: seat ? 0 : 1, y: seat ? 16 : 0 }}
          transition={{ duration: reduced ? 0 : 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="relative border-t border-ed-cream/15 px-6 pt-10 md:px-10 lg:px-14">
            <Star className="top-0 left-0" />
            {/* margin 0: the stage is pinned, so a shrunk viewport is never entered */}
            <Reveal margin="0px">
              <p className={cn(mono, "mb-6 text-ed-cream/60")}>The table</p>
              <Title className="text-[clamp(2.5rem,5.5vw,4.75rem)]">
                {"Twelve seats.\nFive already working."}
              </Title>
            </Reveal>
            <Reveal
              margin="0px"
              delay={0.15}
              className="mt-8 flex flex-col gap-4 md:flex-row md:items-start md:gap-12"
            >
              <Tag>
                {N} seats · {LIVE_SEATS} live
              </Tag>
              <p className="max-w-md text-[15px] leading-relaxed text-ed-cream/85">
                The members that move money are plain code, and they are running
                today. The ones that think are still being built. Keep scrolling
                to go round the table.
              </p>
            </Reveal>
          </div>
        </motion.div>

        <AnimatePresence>
          {seat && (
            <SeatCard
              key={seat.id}
              seat={seat}
              index={step}
              side={side}
              reduced={reduced}
            />
          )}
        </AnimatePresence>

        {/* index: one tick per seat, filling as you scroll; click to jump */}
        <nav
          aria-label="The table"
          className="absolute inset-x-0 bottom-0 z-20 hidden border-t border-ed-cream/15 bg-black/30 backdrop-blur-[2px] md:left-[80px] md:flex"
        >
          {TABLE.map((member, i) => (
            <button
              key={member.id}
              type="button"
              aria-label={`${member.name}, ${member.role}`}
              aria-current={step === i ? "step" : undefined}
              className={cn(
                mono,
                "relative flex-1 px-2 py-4 text-left transition-colors outline-none focus-visible:bg-white/10 lg:px-3",
                step === i
                  ? "text-ed-cream"
                  : "text-ed-cream/45 hover:text-ed-cream/80",
              )}
              onClick={() => go(i)}
            >
              <span
                className={cn(
                  "absolute top-[-1px] left-0 h-px bg-ed-cream transition-all duration-700",
                  step >= i ? "w-full" : "w-0",
                )}
              />
              {pad(i + 1)}
              <span className="ml-2 hidden tracking-[0.16em] xl:inline">
                {member.name}
              </span>
            </button>
          ))}
        </nav>
      </div>

      {/* the same table as plain text, for screen readers and search */}
      <ol className="sr-only">
        {TABLE.map((member) => (
          <li key={member.id}>
            {member.name}, {member.role}: {member.task}
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * One seat, in the landing's own language. On a short desktop window the
 * epigram and the two description rows drop out, so the card still fits
 * between the top bar and the index.
 */
function SeatCard({
  seat,
  index,
  side,
  reduced,
}: {
  seat: Seat;
  index: number;
  side: "left" | "right";
  reduced: boolean;
}) {
  const live = seat.status === "live";
  return (
    <motion.article
      initial={{ opacity: 0, y: 28 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{
        opacity: 0,
        y: -12,
        transition: { duration: reduced ? 0 : 0.25 },
      }}
      transition={{ duration: reduced ? 0 : 0.8, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "absolute inset-x-3 bottom-3 z-30 rounded-[3px] border border-ed-cream/15 bg-ed-dark-2/80 p-5 text-ed-cream shadow-2xl shadow-black/50 backdrop-blur-md sm:inset-x-4 sm:bottom-4",
        "md:inset-x-auto md:top-[calc(50%+12px)] md:bottom-auto md:w-[420px] md:-translate-y-1/2 md:p-7 md:[@media(max-height:820px)]:p-5",
        side === "right"
          ? "md:right-8 lg:right-12"
          : "md:left-[112px] lg:left-[128px]",
      )}
    >
      <Star className="top-0 left-0" />
      <div className="flex items-center justify-between gap-3">
        <span className={cn(mono, "whitespace-nowrap text-ed-cream/45")}>
          {pad(index + 1)} / {pad(N)}
        </span>
        <span
          className={cn(
            mono,
            "inline-flex items-center gap-2 whitespace-nowrap max-sm:tracking-[0.16em]",
            live ? "text-[#9ec28c]" : "text-ed-gold",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              live ? "bg-[#9ec28c]" : "bg-ed-gold",
            )}
          />
          {live ? "Running today" : "In build"}
        </span>
      </div>

      <p
        className={cn(
          mono,
          "mt-5 text-ed-cream/55 md:mt-7 md:[@media(max-height:820px)]:mt-4",
        )}
      >
        {seat.role}
      </p>
      <h3 className="mt-2 font-(family-name:--font-landing-serif) text-[2.6rem] leading-[0.95] font-light tracking-[-0.02em] md:text-[3.4rem] md:[@media(max-height:820px)]:text-[2.6rem]">
        {seat.name}
      </h3>
      <p className="mt-2 hidden font-(family-name:--font-landing-serif) text-lg leading-snug font-light text-ed-cream/65 italic sm:block md:[@media(max-height:820px)]:hidden">
        {seat.epigram}
      </p>
      <p className="mt-4 text-[13px] leading-relaxed text-ed-cream/80 md:mt-5 md:text-[14px] md:[@media(max-height:820px)]:mt-3 md:[@media(max-height:820px)]:text-[13px]">
        {seat.task}
      </p>

      <ul className="mt-4 flex flex-wrap gap-1.5 md:mt-5 md:[@media(max-height:820px)]:mt-3">
        {seat.chips.map((chip) => (
          <li
            key={chip}
            className={cn(
              mono,
              "rounded-[3px] border border-ed-cream/25 bg-black/30 px-2.5 py-1 tracking-[0.18em] text-ed-cream/80",
            )}
          >
            {chip}
          </li>
        ))}
      </ul>

      <dl className="mt-5 border-t border-ed-cream/15 text-[13px] md:mt-6 md:[@media(max-height:820px)]:mt-4">
        <Row
          label="Engine"
          className="max-md:hidden md:[@media(max-height:820px)]:hidden"
        >
          {seat.engine === "code" ? "Deterministic code" : "Language model"}
        </Row>
        <Row
          label="When"
          className="max-md:hidden md:[@media(max-height:820px)]:hidden"
        >
          {seat.when}
        </Row>
        {seat.facts.map((fact) => (
          <Row key={fact.label} label={fact.label}>
            {"code" in fact ? (
              <code className="font-(family-name:--font-landing-mono) text-[11px] text-ed-gold">
                {fact.code}
              </code>
            ) : (
              <span className="text-ed-cream/70">{fact.text}</span>
            )}
          </Row>
        ))}
      </dl>
    </motion.article>
  );
}

function Row({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[6.25rem_minmax(0,1fr)] items-baseline gap-3 border-b border-ed-cream/10 py-2.5 last:border-b-0",
        className,
      )}
    >
      <dt className={cn(mono, "text-ed-cream/40")}>{label}</dt>
      <dd className="min-w-0 text-ed-cream/85">{children}</dd>
    </div>
  );
}
