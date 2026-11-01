"use client";

import { useParams } from "next/navigation";
import { PayPanel } from "@/components/pay/PayPanel";

export default function SlugPayPage() {
  const params = useParams<{ username: string; slug: string }>();
  return (
    <PayPanel
      username={decodeURIComponent(params.username || "").toLowerCase()}
      slug={decodeURIComponent(params.slug || "").toLowerCase()}
    />
  );
}
