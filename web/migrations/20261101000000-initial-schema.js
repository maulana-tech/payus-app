// Initial schema: one account per Privy identity, signed usernames, payment
// links, invoices (one-off and recurring), encrypted payment requests,
// merchant API keys and webhooks, and email notifications.
export const up = async (db) => {
  await db
    .collection("profiles")
    .createIndex({ userId: 1 }, { unique: true, name: "one_profile_per_user" });

  await db
    .collection("payment_links")
    .createIndex({ owner: 1, slug: 1 }, { unique: true, name: "owner_slug" });
  await db
    .collection("payment_links")
    .createIndex({ owner: 1, createdAt: -1 }, { name: "owner_recent" });

  const invoices = db.collection("invoices");
  await invoices.createIndex(
    { owner: 1, number: 1 },
    { unique: true, name: "owner_number" },
  );
  await invoices.createIndex(
    { token: 1 },
    { unique: true, name: "public_token" },
  );
  await invoices.createIndex(
    { owner: 1, createdAt: -1 },
    {
      name: "owner_recent",
    },
  );
  await invoices.createIndex(
    { recurrence: 1, nextIssueAt: 1 },
    { name: "recurring_due" },
  );
  await invoices.createIndex(
    { status: 1, dueDate: 1, reminderSentAt: 1 },
    { name: "reminders_due" },
  );

  const requests = db.collection("payment_requests");
  await requests.createIndex({ to: 1, createdAt: -1 }, { name: "incoming" });
  await requests.createIndex({ from: 1, createdAt: -1 }, { name: "outgoing" });
  await requests.createIndex(
    { to: 1, status: 1 },
    { name: "pending_incoming" },
  );

  await db
    .collection("api_keys")
    .createIndex({ owner: 1, createdAt: -1 }, { name: "by_owner" });
  await db
    .collection("webhook_deliveries")
    .createIndex({ owner: 1, createdAt: -1 }, { name: "by_owner" });

  await db
    .collection("notification_settings")
    .createIndex(
      { unsubscribeToken: 1 },
      { unique: true, name: "unsubscribe_token" },
    );
  await db
    .collection("notification_logs")
    .createIndex({ sentAt: -1 }, { name: "recent" });
};

export const down = async (db) => {
  for (const name of [
    "profiles",
    "payment_links",
    "invoices",
    "payment_requests",
    "api_keys",
    "webhook_deliveries",
    "notification_settings",
    "notification_logs",
  ]) {
    await db
      .collection(name)
      .dropIndexes()
      .catch(() => {});
  }
};
