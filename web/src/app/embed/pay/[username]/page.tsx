import type { Metadata } from "next";
import { EmbedTheme } from "@/components/embed/EmbedTheme";
import { PayPanel } from "@/components/pay/PayPanel";
import { EmbedBridge } from "../../../../components/embed/EmbedBridge";

export const metadata: Metadata = {
  title: "Pay | Payus",
  robots: { index: false, follow: false },
};

export default async function EmbedPayPage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ theme?: string }>;
}) {
  const { username } = await params;
  const { theme } = await searchParams;
  return (
    <>
      <EmbedBridge />
      <EmbedTheme theme={theme} />
      <PayPanel username={decodeURIComponent(username).toLowerCase()} embed />
    </>
  );
}
