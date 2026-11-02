import type { Metadata } from "next";
import { StorefrontPanel } from "@/components/storefront/StorefrontPanel";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Shop | ${APP_NAME}`,
  robots: { index: false, follow: false },
};

export default async function ShopPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <StorefrontPanel slug={slug} />;
}
