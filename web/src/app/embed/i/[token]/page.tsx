import type { Metadata } from "next";
import { EmbedBridge } from "../../../../components/embed/EmbedBridge";
import { EmbedTheme } from "../../../../components/embed/EmbedTheme";
import { InvoicePanel } from "../../../../components/invoices/InvoicePanel";

export const metadata: Metadata = {
  title: "Invoice | Payus",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function EmbedInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ theme?: string }>;
}) {
  const { token } = await params;
  const { theme } = await searchParams;
  return (
    <>
      <EmbedBridge />
      <EmbedTheme theme={theme} />
      <InvoicePanel key={token} token={token} embed />
    </>
  );
}
