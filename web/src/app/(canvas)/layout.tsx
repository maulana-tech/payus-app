import type { ReactNode } from "react";
import { DashboardBackground } from "@/components/dashboard/DashboardBackground";

// The canvas gets the dashboard's colours and nothing else: no navigation,
// no page header, no backdrop. A window you write a page through should be
// the size of the page.
export default function CanvasLayout({ children }: { children: ReactNode }) {
  return (
    <DashboardBackground compact backdrop={false}>
      {children}
    </DashboardBackground>
  );
}
