import { timingSafeEqual } from "node:crypto";
import { getServerEnv } from "@/env.server";
import { runInvoiceSchedule } from "@/server/modules/invoices/invoices.service";

// Issues due recurring invoices and sends overdue reminders. Call it on a
// schedule (e.g. hourly) with `Authorization: Bearer $CRON_SECRET`.
export const dynamic = "force-dynamic";

function authorized(header: string | null, secret: string | undefined) {
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: Request) {
  if (
    !authorized(
      request.headers.get("authorization"),
      getServerEnv().CRON_SECRET,
    )
  )
    return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await runInvoiceSchedule());
}
