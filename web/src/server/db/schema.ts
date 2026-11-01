import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Money is stored as integer minor units in `numeric(20, 0)`, which the pg
// driver hands back as a string — the same shape the services and the API use.
// Never use a float for money.
const minor = (name: string) => numeric(name, { precision: 20, scale: 0 });
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export type AccountType = "personal" | "freelancer" | "business";

/** PIN escrow: the account master encrypted under Argon2id(PIN). */
export type Escrow = {
  encryptedMasterHex: string;
  masterSaltHex: string;
  kdfParams: { m: number; t: number; p: number };
  revision: number;
};

/**
 * Passkey recovery (PRF). Public data only: which credential to ask for and
 * the signing key its master must reproduce.
 */
export type Passkey = {
  credentialId: string;
  transports: string[];
  signPubkeyHex: string;
};

/** One account per Privy identity. Holds recovery metadata, never keys. */
export const users = pgTable("users", {
  id: text("id").primaryKey(), // Privy user id
  email: text("email"),
  escrow: jsonb("escrow").$type<Escrow>(),
  passkey: jsonb("passkey").$type<Passkey>(),
  // Chosen at onboarding; decides which tools the dashboard shows first.
  accountType: text("account_type").$type<AccountType>(),
  businessName: text("business_name"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Public profile: @username → this account's keys, signed by its owner. */
export const profiles = pgTable("profiles", {
  username: text("username").primaryKey(), // lowercase
  userId: text("user_id").notNull().unique(), // Privy user id
  signPubkeyHex: text("sign_pubkey_hex").notNull(), // Ed25519
  msgPubkeyHex: text("msg_pubkey_hex").notNull(), // X25519
  claimJson: text("claim_json").notNull(), // canonical JSON of the claim
  claimSigHex: text("claim_sig_hex").notNull(),
  createdAt: createdAt(),
});

export const paymentLinks = pgTable(
  "payment_links",
  {
    id: text("id").primaryKey(), // public id (base62)
    owner: text("owner").notNull(), // username
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    amountMinor: minor("amount_minor"), // null = payer chooses
    currency: text("currency").notNull(), // ISO 4217
    state: text("state").$type<"active" | "archived">().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("payment_links_owner_slug").on(t.owner, t.slug),
    index("payment_links_owner_recent").on(t.owner, t.createdAt),
  ],
);

export type InvoiceItem = {
  description: string;
  quantity: number;
  unitMinor: string; // minor units of the invoice currency
};

export const invoices = pgTable(
  "invoices",
  {
    id: text("id").primaryKey(), // public id (base62)
    owner: text("owner").notNull(), // username
    number: text("number").notNull(),
    token: text("token").notNull().unique(), // capability for /i/<token>
    clientName: text("client_name").notNull(),
    clientEmail: text("client_email"),
    items: jsonb("items").$type<InvoiceItem[]>().notNull(),
    totalMinor: minor("total_minor").notNull(),
    currency: text("currency").notNull(), // ISO 4217
    notes: text("notes").notNull(),
    // YYYY-MM-DD. Text, so the string comparisons the schedule does are
    // exactly the ones the service and its tests expect.
    dueDate: text("due_date").notNull(),
    status: text("status").$type<"pending" | "paid" | "void">().notNull(),
    // Created through the merchant API (a checkout) with their order reference.
    source: text("source").$type<"dashboard" | "api">(),
    reference: text("reference"),
    // Recurring series: only the newest invoice keeps the schedule.
    recurrence: text("recurrence").$type<"none" | "weekly" | "monthly">(),
    nextIssueAt: timestamp("next_issue_at", { withTimezone: true }),
    seriesNumber: text("series_number"), // number of the first of the series
    seriesIndex: integer("series_index"), // 1 for the first invoice
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    paidMinor: minor("paid_minor").notNull(),
    paidReportedAt: timestamp("paid_reported_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("invoices_owner_number").on(t.owner, t.number),
    index("invoices_owner_recent").on(t.owner, t.createdAt),
    index("invoices_recurring_due").on(t.recurrence, t.nextIssueAt),
    index("invoices_reminders_due").on(t.status, t.dueDate, t.reminderSentAt),
  ],
);

export type Sealed = { epk: string; nonce: string; ct: string };

/**
 * A payment request from one @username to another. Amount and note are
 * sealed to each party's messaging key; the server sees only who asked whom.
 */
export const paymentRequests = pgTable(
  "payment_requests",
  {
    id: text("id").primaryKey(),
    fromUsername: text("from_username").notNull(), // requester (gets paid)
    toUsername: text("to_username").notNull(), // payer
    forPayer: jsonb("for_payer").$type<Sealed>().notNull(),
    forRequester: jsonb("for_requester").$type<Sealed>().notNull(),
    status: text("status")
      .$type<"pending" | "paid" | "declined" | "cancelled">()
      .notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("payment_requests_incoming").on(t.toUsername, t.createdAt),
    index("payment_requests_outgoing").on(t.fromUsername, t.createdAt),
    index("payment_requests_pending_incoming").on(t.toUsername, t.status),
  ],
);

/** Merchant API key. Only a hash of the secret is stored. */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(), // key id, part of the key
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    secretHash: text("secret_hash").notNull(), // sha256 hex of the full key
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("api_keys_by_owner").on(t.owner, t.createdAt)],
);

/** Where to POST signed events for `owner` (one endpoint per account). */
export const webhooks = pgTable("webhooks", {
  owner: text("owner").primaryKey(), // username
  url: text("url").notNull(),
  secret: text("secret").notNull(), // HMAC key, shown to the owner
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    event: text("event").notNull(),
    status: text("status").$type<"delivered" | "failed">().notNull(),
    attempts: integer("attempts").notNull(),
    responseStatus: integer("response_status"),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("webhook_deliveries_by_owner").on(t.owner, t.createdAt)],
);

export type NotificationEvents = {
  invoicePaid: boolean;
  paymentPing: boolean;
  requestReceived: boolean;
};

export const notificationSettings = pgTable("notification_settings", {
  userId: text("user_id").primaryKey(), // Privy user id
  email: text("email").notNull(),
  enabled: boolean("enabled").notNull(),
  events: jsonb("events").$type<NotificationEvents>().notNull(),
  unsubscribeToken: text("unsubscribe_token").notNull().unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type NotificationEventType =
  | "invoicePaid"
  | "invoiceIssued"
  | "invoiceReminder"
  | "paymentPing"
  | "requestReceived"
  | "test";

/** One row per sent notification: its id is the event key, so it is sent once. */
export const notificationLogs = pgTable("notification_logs", {
  id: text("id").primaryKey(), // e.g. "invoice-paid:<id>"
  recipientEmail: text("recipient_email").notNull(),
  eventType: text("event_type").$type<NotificationEventType>().notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserRow = typeof users.$inferSelect;
export type ProfileRow = typeof profiles.$inferSelect;
export type PaymentLinkRow = typeof paymentLinks.$inferSelect;
export type InvoiceRow = typeof invoices.$inferSelect;
export type PaymentRequestRow = typeof paymentRequests.$inferSelect;
export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type WebhookRow = typeof webhooks.$inferSelect;
export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;
export type NotificationSettingsRow = typeof notificationSettings.$inferSelect;
