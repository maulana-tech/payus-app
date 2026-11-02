"use client";

import { DashboardGuard } from "@/components/dashboard/DashboardGuard";
import { TransactionsScreen } from "@/components/dashboard/screens/TransactionsScreen";

export default function DashboardTransactionsPage() {
  return (
    <DashboardGuard
      title="Transactions"
      description="Every posting the ledger has made, with both halves of each one."
    >
      {() => <TransactionsScreen />}
    </DashboardGuard>
  );
}
