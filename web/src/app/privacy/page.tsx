import type { Metadata } from "next";
import Link from "next/link";
import { FooterBar } from "@/components/landing/editorial/sections";
import { mono } from "@/components/landing/editorial/styles";
import { APP_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: `Privacy policy | ${APP_NAME}`,
  description: `What ${APP_NAME} stores and what stays in your browser.`,
};

// Short and honest while the product is being built: it describes what is
// actually stored today, not what a finished policy will say.
export default function PrivacyPage() {
  return (
    <div className="flex min-h-svh flex-col bg-ed-dark-2 font-(family-name:--font-landing) text-ed-cream">
      <main
        id="main-content"
        className="mx-auto grid w-full max-w-3xl flex-1 gap-6 px-6 py-24 sm:px-10"
      >
        <Link
          href="/"
          className={cn(mono, "text-ed-cream/60 hover:text-ed-cream")}
        >
          ← Back
        </Link>
        <h1 className="font-(family-name:--font-landing-serif) text-[clamp(2.5rem,5vw,4rem)] leading-[0.95] font-light tracking-[-0.02em]">
          Privacy policy
        </h1>
        <p className="text-[15px] leading-relaxed text-ed-cream/75">
          {APP_NAME} stores what the app needs to work: your login identity
          (through Privy), your username, your account type, and the links,
          invoices, requests and payments you create. Recovery keys are derived
          in your browser from a passkey or a PIN and are never sent to the
          server.
        </p>
        <p className="text-[15px] leading-relaxed text-ed-cream/75">
          Processors in use: Privy for login, PayPal for payments, a Postgres
          database for application data, and Resend for email notifications if
          you turn them on. Card details never reach us — the payer enters them
          at PayPal.
        </p>
        <p className="text-[15px] leading-relaxed text-ed-cream/75">
          This policy will be expanded before anyone is charged real money.
          Today {APP_NAME} runs against the PayPal sandbox.
        </p>
      </main>
      {/* A landmark of its own: on the landing this bar sits inside the
          page's <footer>, but here it is the only thing after <main>, and
          content outside every landmark is content a screen reader has no
          way to jump to. */}
      <footer>
        <FooterBar />
      </footer>
    </div>
  );
}
