"use client";

import { DashboardGuard } from "@/components/dashboard/DashboardGuard";
import { DevelopersScreen } from "@/components/dashboard/screens/DevelopersScreen";

export default function DashboardDevelopersPage() {
  return (
    <DashboardGuard
      title="Developers"
      description="API keys for the checkout API, and the endpoint we sign events to."
    >
      {() => <DevelopersScreen />}
    </DashboardGuard>
  );
}
