import { demoMode, demoUser } from "@/lib/demo";
import { ensureDemoAccount } from "@/server/modules/demo/demo.service";
import { seedDemoAccount } from "@/server/modules/demo/seed.service";

// The development door to the seeder. Demo mode is development-only, so
// this answers 404 anywhere else; the public demo seeds its own sandboxes
// through the same service without going through here.
export const dynamic = "force-dynamic";

export async function POST() {
  if (!demoMode()) return new Response("Not found", { status: 404 });
  const owner = demoUser();
  if (!owner) return new Response("Not found", { status: 404 });
  await ensureDemoAccount();
  return Response.json({ owner, made: await seedDemoAccount(owner) });
}
