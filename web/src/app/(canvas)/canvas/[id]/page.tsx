"use client";

import { use } from "react";
import { CanvasEditor } from "@/components/canvas/CanvasEditor";
import { DashboardGuard } from "@/components/dashboard/DashboardGuard";

export default function CanvasPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <DashboardGuard
      title="Shop"
      description="The page, and what makes it."
      header={false}
    >
      {() => <CanvasEditor id={id} />}
    </DashboardGuard>
  );
}
