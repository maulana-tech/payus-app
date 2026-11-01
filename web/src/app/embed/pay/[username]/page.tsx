import type { Metadata } from "next";
import { EmbedTheme } from "@/components/embed/EmbedTheme";
import { PayPanel } from "@/components/pay/PayPanel";

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
      <EmbedTheme theme={theme} />
      <PayPanel username={decodeURIComponent(username).toLowerCase()} />
    </>
  );
}
