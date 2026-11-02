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
export const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  style: ["normal", "italic"],
  variable: "--font-cormorant",
  display: "swap",
});
