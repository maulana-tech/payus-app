"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Cta } from "./frame";
import { Film, Reveal, Star, Tag, Title } from "./kit";
import { mono, RAIL } from "./styles";

export function Hero() {
  return (
    <section
      className={cn(
        "relative isolate flex min-h-svh flex-col text-ed-cream",
        RAIL,
      )}
    >
      <Film name="split" />
      <div className="flex flex-1 flex-col justify-center px-6 pt-28 md:px-10 lg:px-14">
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-1000 fill-mode-both">
          <h1 className="max-w-4xl font-(family-name:--font-landing-serif) text-[clamp(3.25rem,8.5vw,7.5rem)] leading-[0.92] font-light tracking-[-0.03em]">
            Money that files itself.
          </h1>
        </div>
        <div className="animate-in fade-in slide-in-from-bottom-4 delay-150 duration-1000 fill-mode-both">
          <p className="mt-6 max-w-md font-(family-name:--font-landing-serif) text-[clamp(1.25rem,2.2vw,1.75rem)] leading-[1.2] font-light whitespace-pre-line text-ed-cream/90">
            {"Not a dashboard you reconcile.\nA ledger that was never wrong."}
          </p>
        </div>
        <div className="mt-10 animate-in fade-in delay-300 duration-1000 fill-mode-both">
          <Cta />
        </div>
      </div>
      <div className="relative border-t border-ed-cream/15 px-6 pt-8 pb-10 md:px-10 lg:pl-[260px]">
        <Star className="top-0 left-0" />
        <p className="max-w-md text-[15px] leading-relaxed text-ed-cream/85">
          A payment arrives through PayPal and posts itself — debited, credited,
          balanced, once. Agents propose what should happen next; a rule engine,
          not a model, decides whether it happens at all.
        </p>
        <p className={cn(mono, "mt-8 text-ed-cream/50")}>
          PayPal AI Hackathon 2026 · Sandbox · Built in the open
        </p>
      </div>
    </section>
  );
}

export function Chapter({
  id,
  film,
  tag,
  title,
  body,
}: {
  id: string;
  film: string;
  tag: string;
  title: string;
  body: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "relative isolate flex min-h-svh scroll-mt-20 flex-col justify-end text-ed-cream",
        RAIL,
      )}
    >
      <Film name={film} dim="from-black/65 via-black/20" />
      <div className="relative border-t border-ed-cream/15 px-6 pt-10 pb-16 md:px-10 lg:px-14">
        <Star className="top-0 left-0" />
        <Reveal>
          <Title>{title}</Title>
        </Reveal>
        <Reveal
          delay={0.15}
          className="mt-8 flex flex-col gap-4 md:flex-row md:items-start md:gap-12"
        >
          <Tag>{tag}</Tag>
          <p className="max-w-lg text-[15px] leading-relaxed text-ed-cream/85">
            {body}
          </p>
        </Reveal>
      </div>
    </section>
  );
}

const KINDS: { label: string; tagline: string; rule: string; href: string }[] =
  [
    {
      label: "Link",
      tagline: "A page at your own name.",
      rule: "payus.app/@you/coffee. Set the price, or let them choose it. Share it anywhere a link goes.",
      href: "/links",
    },
    {
      label: "Invoice",
      tagline: "Numbered, dated, repeating.",
      rule: "It issues the next one on schedule and reminds a client who is late, without you opening the app.",
      href: "/invoices",
    },
    {
      label: "Checkout",
      tagline: "One POST from your server.",
      rule: "Create a checkout with an API key, drop in the widget, and take a signed webhook the moment it is paid.",
      href: "/developers",
    },
  ];

/** What a capture actually writes — the example is the code's own arithmetic. */
const ENTRIES: { account: string; debit?: string; credit?: string }[] = [
  { account: "paypal_cash", debit: "145.00" },
  { account: "psp_fee", debit: "5.00" },
  { account: "in_flight:acme", credit: "150.00" },
];

export function Ways() {
  return (
    <section
      id="ways"
      className={cn("relative scroll-mt-20 bg-ed-dark-2 text-ed-cream", RAIL)}
    >
      <div className="relative border-t border-ed-cream/15 px-6 pt-20 pb-10 md:px-10 md:pt-28 lg:px-14">
        <Star className="top-0 left-0" />
        <Reveal>
          <Title className="text-[clamp(2.5rem,5.5vw,4.75rem)]">
            {"Three ways\nto be paid."}
          </Title>
        </Reveal>
      </div>
      <div className="grid border-t border-ed-cream/15 md:grid-cols-3">
        {KINDS.map((kind, i) => (
          <Reveal
            key={kind.label}
            delay={i * 0.1}
            className={cn(
              "relative px-6 py-10 md:px-10 lg:px-14",
              i > 0 && "border-t border-ed-cream/15 md:border-t-0 md:border-l",
            )}
          >
            {i === 0 && <Star className="top-0 left-0" />}
            <p className={cn(mono, "text-ed-cream/55")}>
              0{i + 1} · {kind.label}
            </p>
            <p className="mt-4 font-(family-name:--font-landing-serif) text-[clamp(1.5rem,2.4vw,2rem)] leading-[1.1] font-light">
              {kind.tagline}
            </p>
            <p className="mt-4 text-[14px] leading-relaxed text-ed-cream/65">
              {kind.rule}
            </p>
          </Reveal>
        ))}
      </div>

      <div className="relative grid gap-12 border-t border-ed-cream/15 px-6 py-16 md:grid-cols-[1fr_1.1fr] md:px-10 lg:px-14">
        <Star className="top-0 left-0" />
        <Reveal>
          <p className={cn(mono, "text-ed-cream/45")}>What a payment writes</p>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-ed-cream/80">
            Nothing here is a mock-up. One sandbox capture of $150.00, with
            PayPal keeping $5.00, posts these three lines and no others. The
            debits equal the credits, or the write never happens.
          </p>
        </Reveal>
        <Reveal delay={0.15}>
          <div className="rounded-[3px] border border-ed-cream/15 bg-black/25 p-5 md:p-6">
            <p className={cn(mono, "text-ed-cream/45")}>
              capture:5O190127TN · payment.captured
            </p>
            <dl className="mt-4 font-(family-name:--font-landing-mono) text-[12px] md:text-[13px]">
              {ENTRIES.map((entry) => (
                <div
                  key={entry.account}
                  className="grid grid-cols-[minmax(0,1fr)_5rem_5rem] items-baseline gap-2 border-b border-ed-cream/10 py-2.5 last:border-b-0"
                >
                  <dt className="truncate text-ed-cream/85">{entry.account}</dt>
                  <dd className="text-right text-ed-gold">
                    {entry.debit ?? "—"}
                  </dd>
                  <dd className="text-right text-ed-cream/60">
                    {entry.credit ?? "—"}
                  </dd>
                </div>
              ))}
            </dl>
            <p
              className={cn(mono, "mt-4 flex justify-between text-ed-cream/40")}
            >
              <span>Debit 150.00</span>
              <span>Credit 150.00</span>
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

const TERMS: { title: string; body: string; note: string }[] = [
  {
    title: "No model\ntouches money.",
    body: "An agent's entire power is to write down what it would like to happen. Carrying it out is a separate, boring program that checks the request against your limits first.",
    note: "The limits live in the database, not in the prompt. A model that asks for something outside them gets a refusal and a logged reason — not an exception.",
  },
  {
    title: "Every number\ncomes from the books.",
    body: "Reports and answers are written over query results. The model is handed rows and asked for sentences; it is never asked to remember a balance.",
    note: "The ledger is double entry in integer minor units — no floating point anywhere. If debits and credits ever disagreed, the write would have been refused before it happened.",
  },
];

export function Terms() {
  return (
    <section
      id="terms"
      className={cn("relative scroll-mt-20 bg-ed-dark-2 text-ed-cream", RAIL)}
    >
      {TERMS.map((block, i) => (
        <div
          key={block.title}
          className="relative grid gap-10 border-t border-ed-cream/15 px-6 py-20 md:grid-cols-[1.1fr_1fr] md:px-10 md:py-28 lg:px-14"
        >
          <Star className="top-0 left-0" />
          <Reveal>
            <p className={cn(mono, "mb-6 text-ed-cream/45")}>0{i + 1}</p>
            <Title className="text-[clamp(2.5rem,5.5vw,4.75rem)]">
              {block.title}
            </Title>
            <p className="mt-6 max-w-md text-[15px] leading-relaxed text-ed-cream/75">
              {block.body}
            </p>
          </Reveal>
          <Reveal
            delay={0.15}
            className="self-end border-l border-ed-cream/15 pl-6"
          >
            <p className={cn(mono, "mb-3 text-ed-cream/45")}>Full disclosure</p>
            <p className="max-w-md text-[15px] leading-relaxed text-ed-cream/85">
              {block.note}
            </p>
          </Reveal>
        </div>
      ))}
    </section>
  );
}

const FAQ: { q: string; a: string }[] = [
  {
    q: "Is this real money?",
    a: "No. Payus runs against the PayPal sandbox with test accounts, built for the PayPal AI Hackathon 2026.",
  },
  {
    q: "What can an agent actually do?",
    a: "Write a proposal. That is the whole list. A deterministic engine decides whether it runs, and an approval is tied to the hash of the exact proposal it approved.",
  },
  {
    q: "What if PayPal sends the same event twice?",
    a: "Nothing happens twice. The event is stored under its own id, and the ledger refuses a second posting of the same capture. A redelivery is answered 200 and dropped.",
  },
  {
    q: "Where do the numbers in a report come from?",
    a: "From SQL over the ledger. The model receives rows and writes sentences; it has no write access and nothing to remember.",
  },
  {
    q: "Can I take payments from my own app?",
    a: "Yes. Create a checkout with one authenticated POST, send your customer to the page or embed the widget, and take a signed webhook when it is paid.",
  },
];

export function Questions() {
  return (
    <section
      id="questions"
      className={cn("relative scroll-mt-20 bg-ed-dark-2 text-ed-cream", RAIL)}
    >
      <div className="relative grid gap-12 border-t border-ed-cream/15 px-6 py-20 md:grid-cols-[1fr_1.4fr] md:px-10 md:py-28 lg:px-14">
        <Star className="top-0 left-0" />
        <Reveal>
          <Title className="text-[clamp(2.5rem,5.5vw,4.75rem)]">
            Asked before.
          </Title>
        </Reveal>
        <div>
          {FAQ.map((item) => (
            <details
              key={item.q}
              className="group border-t border-ed-cream/15 py-5 last:border-b"
            >
              <summary className="flex cursor-pointer list-none items-start justify-between gap-6 font-(family-name:--font-landing-serif) text-[clamp(1.25rem,2vw,1.6rem)] font-light [&::-webkit-details-marker]:hidden">
                {item.q}
                <Plus
                  aria-hidden="true"
                  className="mt-1.5 size-4 shrink-0 text-ed-cream/60 transition-transform duration-300 group-open:rotate-45"
                />
              </summary>
              <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ed-cream/70">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Closing() {
  return (
    <footer className={cn("relative isolate text-ed-cream", RAIL)}>
      <Film name="split" dim="from-black/80 via-black/50" />
      <div className="relative flex min-h-[80svh] flex-col justify-center border-t border-ed-cream/15 px-6 py-24 md:px-10 lg:px-14">
        <Star className="top-0 left-0" />
        <Reveal>
          <Title>{"The rail is finished.\nThe table is being set."}</Title>
        </Reveal>
        <Reveal delay={0.15} className="mt-10">
          <Cta />
        </Reveal>
      </div>
      <FooterBar />
    </footer>
  );
}

/** The last hairline of any page in the landing's language. */
export function FooterBar() {
  return (
    <div className="relative flex flex-wrap items-center justify-between gap-4 border-t border-ed-cream/15 bg-black/60 px-6 py-5 text-ed-cream md:px-10 lg:px-14">
      <p className={cn(mono, "text-ed-cream/60")}>
        Payus · PayPal AI Hackathon 2026
      </p>
      <div className={cn(mono, "flex gap-6 text-ed-cream/60")}>
        <Link href="/developers" className="hover:text-ed-cream">
          Checkout API
        </Link>
        <a href="/embed-demo.html" className="hover:text-ed-cream">
          Widget demo
        </a>
        <Link href="/privacy" className="hover:text-ed-cream">
          Privacy
        </Link>
      </div>
    </div>
  );
}
