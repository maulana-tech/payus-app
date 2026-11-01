"use client";

import { DashboardPlaceholder } from "@/components/dashboard/DashboardPlaceholder";
import { SettingsDashboard } from "@/components/dashboard/SettingsDashboard";
import { useSession } from "@/components/SessionProvider";

export default function DashboardSettingsPage() {
  const { username } = useSession();

  return username ? (
    <SettingsDashboard username={username} />
  ) : (
    <DashboardPlaceholder
      title="Settings"
      description="Your account, how you unlock it, and notifications."
    />
  );
}
