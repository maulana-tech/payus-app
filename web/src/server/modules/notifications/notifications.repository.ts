import "server-only";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  getDb,
  isUniqueViolation,
  type NotificationEvents,
  type NotificationEventType,
  type NotificationSettingsRow,
  notificationLogs,
  notificationSettings,
} from "../../db/client";

export type { NotificationEvents };

export async function findSettings(
  userId: string,
): Promise<NotificationSettingsRow | null> {
  const [row] = await getDb()
    .select()
    .from(notificationSettings)
    .where(eq(notificationSettings.userId, userId))
    .limit(1);
  return row ?? null;
}

export async function upsertNotificationSettings(
  userId: string,
  email: string,
  enabled: boolean,
  events: NotificationEvents,
): Promise<NotificationSettingsRow> {
  const now = new Date();
  // The unsubscribe token is issued once and kept, so links already in sent
  // mail keep working.
  const [row] = await getDb()
    .insert(notificationSettings)
    .values({
      userId,
      email,
      enabled,
      events,
      unsubscribeToken: randomBytes(24).toString("hex"),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: notificationSettings.userId,
      set: { email, enabled, events, updatedAt: now },
    })
    .returning();
  return row;
}

export async function disableByUnsubscribeToken(
  token: string,
): Promise<boolean> {
  const updated = await getDb()
    .update(notificationSettings)
    .set({ enabled: false, updatedAt: new Date() })
    .where(eq(notificationSettings.unsubscribeToken, token))
    .returning({ userId: notificationSettings.userId });
  return updated.length > 0;
}

/** Reserves an event key; false when this event was already sent. */
export async function recordNotificationLog(
  eventKey: string,
  recipientEmail: string,
  eventType: NotificationEventType,
): Promise<boolean> {
  try {
    const inserted = await getDb()
      .insert(notificationLogs)
      .values({ id: eventKey, recipientEmail, eventType, sentAt: new Date() })
      .onConflictDoNothing()
      .returning({ id: notificationLogs.id });
    return inserted.length > 0;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}
