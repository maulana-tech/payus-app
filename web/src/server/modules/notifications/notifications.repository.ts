import "server-only";
import { randomBytes } from "node:crypto";
import {
  getNotificationLogs,
  getNotificationSettings,
  type NotificationLogDoc,
  type NotificationSettingsDoc,
} from "../../db/mongo";

export type NotificationEvents = NotificationSettingsDoc["events"];

export async function findSettings(
  userId: string,
): Promise<NotificationSettingsDoc | null> {
  return (await getNotificationSettings()).findOne({ _id: userId });
}

export async function upsertNotificationSettings(
  userId: string,
  email: string,
  enabled: boolean,
  events: NotificationEvents,
): Promise<NotificationSettingsDoc> {
  const collection = await getNotificationSettings();
  const now = new Date();
  const existing = await collection.findOne({ _id: userId });
  const doc: NotificationSettingsDoc = {
    _id: userId,
    email,
    enabled,
    events,
    unsubscribeToken:
      existing?.unsubscribeToken ?? randomBytes(24).toString("hex"),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await collection.updateOne({ _id: userId }, { $set: doc }, { upsert: true });
  return doc;
}

export async function disableByUnsubscribeToken(
  token: string,
): Promise<boolean> {
  const res = await (await getNotificationSettings()).updateOne(
    { unsubscribeToken: token },
    { $set: { enabled: false, updatedAt: new Date() } },
  );
  return res.modifiedCount > 0;
}

/** Reserves an event key; false when this event was already sent. */
export async function recordNotificationLog(
  eventKey: string,
  recipientEmail: string,
  eventType: NotificationLogDoc["eventType"],
): Promise<boolean> {
  try {
    await (await getNotificationLogs()).insertOne({
      _id: eventKey,
      recipientEmail,
      eventType,
      sentAt: new Date(),
    });
    return true;
  } catch (error) {
    if ((error as { code?: unknown }).code === 11000) return false;
    throw error;
  }
}
