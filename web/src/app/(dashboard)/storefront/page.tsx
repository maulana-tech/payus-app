"use client";

import { DashboardGuard } from "@/components/dashboard/DashboardGuard";
import { StorefrontScreen } from "@/components/dashboard/screens/StorefrontScreen";

export default function DashboardStorefrontPage() {
  return (
    <DashboardGuard
      title="Shop"
      description="A page of things people can pay for, published at an address you choose."
    >
      {() => <StorefrontScreen />}
    </DashboardGuard>
  );
}
