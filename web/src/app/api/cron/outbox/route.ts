import { cronAuthorized } from "@/server/lib/cronAuth";
import { expireStaleProposals } from "@/server/modules/guardian/guardian.service";
import { drainOutbox } from "@/server/modules/outbox/outbox.service";

// Runs queued money-path work (a confirmed PayPal capture becoming a paid
// invoice). Call it every minute with `Authorization: Bearer $CRON_SECRET`.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!cronAuthorized(request))
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const [jobs, expired] = await Promise.all([
    drainOutbox(),
    expireStaleProposals(),
  ]);
  return Response.json({ ...jobs, expired });
}
