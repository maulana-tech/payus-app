import Image from "next/image";
import { Frame } from "./primitives";

const COLUMNS: {
  title: string;
  links: { label: string; href: string }[];
}[] = [
  {
    title: "Product",
    links: [{ label: "Privacy policy", href: "/privacy" }],
  },
  {
    title: "Developers",
    links: [
      { label: "Checkout API", href: "/developers" },
      { label: "Widget demo", href: "/embed-demo.html" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="bg-void text-starlight">
      <Frame className="grid gap-12 py-16 lg:grid-cols-[1.4fr_2fr]">
        <div>
          <a
            href="#top"
            className="inline-flex items-center gap-2.5 text-starlight hover:text-starlight"
            aria-label="Payus home"
          >
            <Image src="/assets/payus.svg" alt="" width={28} height={28} />
            <span className="text-xl font-medium tracking-tight">Payus</span>
          </a>
          <p className="mt-4 max-w-[36ch] text-sm leading-relaxed text-starlight/55">
            Payment links, invoices and checkout. Private by default, provable
            on demand.
          </p>
        </div>
        <nav
          aria-label="Footer"
          className="grid grid-cols-2 gap-10 sm:grid-cols-3"
        >
          {COLUMNS.map((column) => (
            <div key={column.title}>
              <h2 className="text-sm text-starlight/50">{column.title}</h2>
              <ul className="mt-4 grid list-none gap-3">
                {column.links.map((link) => {
                  const external = link.href.startsWith("http");
                  return (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        target={external ? "_blank" : undefined}
                        rel={external ? "noreferrer" : undefined}
                        className="text-[15px] text-starlight/85 transition-colors hover:text-starlight"
                      >
                        {link.label}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </Frame>
      <Frame className="flex flex-wrap items-center justify-between gap-3 border-t border-starlight/10 py-6 text-xs text-starlight/45">
        <a href="/privacy" className="hover:text-starlight/80">
          Privacy policy
        </a>
        <span>© {new Date().getFullYear()} Payus. All rights reserved.</span>
      </Frame>
    </footer>
  );
}
