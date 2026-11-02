"use client";

import { DashboardGuard } from "@/components/dashboard/DashboardGuard";
import { OverviewScreen } from "@/components/dashboard/screens/OverviewScreen";

export default function DashboardPage() {
  return (
    <DashboardGuard
      title="Overview"
      description="What you are owed, what has been paid, and what the ledger says about both."
    >
      {(username) => <OverviewScreen username={username} />}
    </DashboardGuard>
  );
}
