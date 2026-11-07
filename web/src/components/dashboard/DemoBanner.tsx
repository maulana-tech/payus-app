"use client";

import { demoUser, isDemoOwner } from "@/lib/demo";
import { useSession } from "../SessionProvider";

// Says what this is, on every screen.
//
// A demo that looks exactly like the real thing is a demo someone can
// mistake for their own account — and this one is open to anyone, with
// sandbox money and a ledger that was seeded rather than earned. The band
// is small and it does not go away, because the moment it does is the
// moment someone starts reading these figures as theirs.

export function DemoBanner() {
  const { username } = useSession();
  // `publicDemo()` says the deployment offers sandboxes; it does not say
  // this visitor is in one. Telling a real owner their money is made-up is
  // the same mistake as not telling a visitor, pointed the other way.
  if (!demoUser() && !(username && isDemoOwner(username))) return null;
  return (
    <p className="border-b border-(--dash-line) bg-(--dash-tint) px-4 py-1.5 text-center text-[11px] text-(--dash-ash)">
      <span className="font-semibold tracking-[0.1em] text-(--dash-fg) uppercase">
        Demo
      </span>
      {" · "}
      Your own sandbox{username ? ` (@${username})` : ""}, filled with made-up
      money. PayPal is in test mode, nothing is sent, and no email leaves.
    </p>
  );
}
