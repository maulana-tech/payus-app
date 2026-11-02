import { getDb, webhookEvents } from "@/server/db/client";
import { paypalConfigured, verifyWebhookSignature } from "@/server/lib/paypal";
import { enqueue } from "@/server/modules/outbox/outbox.service";
import { topics } from "@/server/modules/outbox/topics";

// PayPal's events. Every delivery is verified with PayPal, stored under its
// own `event_id` and turned into outbox work in the same transaction. A
// redelivery finds the id taken and changes nothing.
export const dynamic = "force-dynamic";

type PaypalEvent = {
  id?: string;
  event_type?: string;
  resource?: { id?: string };
};

export async function POST(request: Request) {
  const raw = await request.text();
  if (!paypalConfigured())
    return Response.json({ error: "paypal_not_configured" }, { status: 503 });
  if (!(await verifyWebhookSignature(request.headers, raw)))
    return Response.json({ error: "invalid_signature" }, { status: 400 });

  let event: PaypalEvent;
  try {
    event = JSON.parse(raw) as PaypalEvent;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const eventId = event.id;
  const eventType = event.event_type;
  if (!eventId || !eventType)
    return Response.json({ error: "invalid_event" }, { status: 400 });

  const result = await getDb().transaction(async (tx) => {
    const [stored] = await tx
      .insert(webhookEvents)
      .values({
        eventId,
        provider: "paypal",
        eventType,
        payload: event as Record<string, unknown>,
      })
      .onConflictDoNothing()
      .returning({ eventId: webhookEvents.eventId });
    if (!stored) return { duplicate: true, queued: false };
    // Only a completed capture moves money today; the rest is recorded so
    // the history is complete and a later phase can pick it up.
    const captureId = event.resource?.id;
    if (eventType === "PAYMENT.CAPTURE.COMPLETED" && captureId) {
      await enqueue(topics.captureCompleted, { captureId }, tx);
      return { duplicate: false, queued: true };
    }
    return { duplicate: false, queued: false };
  });
  return Response.json({ received: true, ...result });
}
