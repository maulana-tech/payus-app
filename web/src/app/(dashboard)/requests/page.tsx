"use client";

import { DashboardGuard } from "@/components/dashboard/DashboardGuard";
import { RequestsScreen } from "@/components/dashboard/screens/RequestsScreen";

export default function DashboardRequestsPage() {
  return (
    <DashboardGuard
      title="Requests"
      description="Ask another @username to pay you. The amount and the note are sealed to the two of you."
    >
      {() => <RequestsScreen />}
    </DashboardGuard>
  );
}
