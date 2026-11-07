"use client";

import { DashboardGuard } from "@/components/dashboard/DashboardGuard";
import { AgentsScreen } from "@/components/dashboard/screens/AgentsScreen";

export default function DashboardAgentsPage() {
  return (
    <DashboardGuard
      title="Agents"
      description="Ask about your money. The answer arrives with the rows it was written from."
    >
      {() => <AgentsScreen />}
    </DashboardGuard>
  );
}
