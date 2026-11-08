import { Cormorant_Garamond, JetBrains_Mono, Urbanist } from "next/font/google";

// Shared by the landing page and the dashboard. The variables are set on <html>
// (app/layout.tsx); each surface opts in through its own font-family.
export const urbanist = Urbanist({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-urbanist",
  display: "swap",
});

export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

// The editorial landing sets its headlines in this; nothing else uses it.
//
// One weight, because one weight is what the pages ask for: every use of
// `--font-landing-serif` in this repo carries `font-light`. The other two
// were four more files fetched from Google during the build and never sent
// to a browser — and a build that fetches twelve fonts fails when any one
// of them answers oddly, which is how a deployment was lost.
export const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300"],
  style: ["normal", "italic"],
  variable: "--font-cormorant",
  display: "swap",
});
