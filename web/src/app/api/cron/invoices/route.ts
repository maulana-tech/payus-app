import { cronAuthorized } from "@/server/lib/cronAuth";
import { runInvoiceSchedule } from "@/server/modules/invoices/invoices.service";

// Issues due recurring invoices and sends overdue reminders. Call it on a
// schedule (e.g. hourly) with `Authorization: Bearer $CRON_SECRET`.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!cronAuthorized(request))
    return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await runInvoiceSchedule());
}
