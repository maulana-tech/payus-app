"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import type { ReactNode } from "react";
import { env } from "@/env";
import { APP_NAME } from "@/lib/brand";

export const privyAppId =
  env.NEXT_PUBLIC_PRIVY_APP_ID || "missing_privy_app_id";

export function PrivyAppProvider({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={privyAppId}
      config={{
        loginMethods: ["google", "passkey", "email"],
        appearance: {
          theme: "dark",
          accentColor: "#91975b",
          landingHeader: `Sign in to ${APP_NAME}`,
          loginMessage: "Use Email, Google, or a passkey.",
        },
        // Privy is only the login. Account keys come from the user's passkey or
        // PIN, never from a Privy wallet.
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
          solana: { createOnLogin: "off" },
        },
        // No EVM/Solana wallet connectors: they're unused here.
        externalWallets: { disableAllExternalWallets: true },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
