"use client";

import { useParams } from "next/navigation";
import { PayPanel } from "@/components/pay/PayPanel";

export default function PayPage() {
  const params = useParams<{ username: string }>();
  return (
    <PayPanel
      username={decodeURIComponent(params.username || "").toLowerCase()}
    />
  );
}
