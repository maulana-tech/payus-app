"use client";

import { DashboardGuard } from "@/components/dashboard/DashboardGuard";
import { SettlementPanel } from "@/components/dashboard/screens/SettlementPanel";
import { TransactionsScreen } from "@/components/dashboard/screens/TransactionsScreen";

export default function DashboardTransactionsPage() {
  return (
    <DashboardGuard
      title="Transactions"
      description="Every posting the ledger has made, with both halves of each one."
    >
      {(username) => (
        <div className="grid gap-4">
          <SettlementPanel owner={username} />
          <TransactionsScreen />
        </div>
      )}
    </DashboardGuard>
  );
}
