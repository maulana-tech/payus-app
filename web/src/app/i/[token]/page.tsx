import type { Metadata } from "next";
import { InvoicePanel } from "../../../components/invoices/InvoicePanel";

export const metadata: Metadata = {
  title: "Invoice | Payus",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function PublicInvoicePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <InvoicePanel key={token} token={token} />;
}
