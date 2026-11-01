import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/landing/Footer";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Privacy Policy | ${APP_NAME}`,
  description: `What ${APP_NAME} stores and what stays in your browser.`,
};

// Placeholder policy: the detailed one described the previous payment rail
// being rewritten for the new payment rail. Keep this honest and short until
// the data flows are settled.
export default function PrivacyPage() {
  return (
    <div className="bg-void text-starlight">
      <main
        id="main-content"
        className="mx-auto grid max-w-3xl gap-6 px-6 py-24 sm:px-10"
      >
        <Link
          href="/"
          className="text-sm text-starlight/60 underline-offset-4 hover:text-starlight hover:underline"
        >
          ← Back
        </Link>
        <h1 className="text-[clamp(2rem,4vw,3rem)] leading-tight font-normal tracking-tight">
          Privacy policy
        </h1>
        <p className="text-[15px] leading-relaxed text-starlight/70">
          This policy is being rewritten along with the payment rail. Today
          {` ${APP_NAME} `}
          stores only what the app needs to work: your login identity (through
          Privy), your username, your account type, and the links, invoices and
          requests you create. Account recovery keys are derived in your browser
          from a passkey or a PIN and are never sent to the server.
        </p>
        <p className="text-[15px] leading-relaxed text-starlight/70">
          Service providers in use: Privy (login), MongoDB (application data)
          and Resend (email notifications, if you enable them).
        </p>
      </main>
      <Footer />
    </div>
  );
}
