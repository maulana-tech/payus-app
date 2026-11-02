"use client";

import { DashboardGuard } from "@/components/dashboard/DashboardGuard";
import { InvoicesScreen } from "@/components/dashboard/screens/InvoicesScreen";

export default function DashboardInvoicesPage() {
  return (
    <DashboardGuard
      title="Invoices"
      description="One-off and recurring, each with a page your client can pay on."
    >
      {() => <InvoicesScreen />}
    </DashboardGuard>
  );
}
