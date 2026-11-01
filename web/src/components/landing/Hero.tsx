"use client";

import { ArrowRight } from "lucide-react";
import { APP_NAME } from "@/lib/brand";
import { useSession } from "../SessionProvider";
import { MonoLabel, Nebula, pillSolidViolet } from "./primitives";

export function Hero() {
  const { authenticated, username, signIn } = useSession();

  return (
    <section
      id="hero"
      className="relative isolate flex min-h-svh items-center overflow-hidden bg-void px-6 text-starlight sm:px-10"
    >
      <Nebula />
      <div className="relative mx-auto grid w-full max-w-5xl gap-8 py-28">
        <MonoLabel>{APP_NAME}</MonoLabel>
        <h1 className="max-w-3xl text-[clamp(2.6rem,6vw,4.75rem)] leading-[1.02] font-normal tracking-tight">
          Get paid with a link, an invoice or a checkout.
        </h1>
        <p className="max-w-xl text-[17px] leading-relaxed text-starlight/70">
          A username, payment links, invoices that reconcile themselves, and a
          checkout API with signed webhooks. The payment rail is being rebuilt —
          everything around it is here.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => signIn()}
            className={`${pillSolidViolet} inline-flex items-center gap-2 px-6 py-3 text-sm`}
          >
            {authenticated && username ? `Open @${username}` : "Get started"}
            <ArrowRight className="size-4" aria-hidden="true" />
          </button>
          <a
            href="/embed-demo.html"
            className="text-sm text-starlight/60 underline-offset-4 hover:text-starlight hover:underline"
          >
            See the widget demo
          </a>
        </div>
      </div>
    </section>
  );
}
