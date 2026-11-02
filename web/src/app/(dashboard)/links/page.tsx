"use client";

import { DashboardGuard } from "@/components/dashboard/DashboardGuard";
import { LinksScreen } from "@/components/dashboard/screens/LinksScreen";

export default function DashboardLinksPage() {
  return (
    <DashboardGuard
      title="Payment links"
      description="Reusable addresses with a fixed price, or an amount the payer chooses."
    >
      {(username) => <LinksScreen username={username} />}
    </DashboardGuard>
  );
}
