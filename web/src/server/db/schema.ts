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
    /**
     * How many times this client has been asked. The Collector stops at
     * three: past that it is a conversation for a person, not a letter.
     */
    remindersSent: integer("reminders_sent").notNull().default(0),
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

// ── The money path ───────────────────────────────────────────────────────
// Double-entry: every transaction has one `ledger_txns` row (its id is the
// idempotency key) and two or more `ledger_entries` whose Σdebit = Σcredit.

export type AccountKind =
  | "pos" // one envelope of a user: pos:<owner>:<slug>
  | "in_flight" // captured, not split yet
  | "platform_fee"
  | "tax_reserve"
  | "merchant_payable"
  | "paypal_cash" // asset: balance held at PayPal
  | "psp_fee" // expense: what PayPal keeps
  | "external"; // a source or sink outside this system

/** A ledger account. Its id is `<kind>`, `<kind>:<owner>` or `pos:<owner>:<slug>`. */
export const ledgerAccounts = pgTable(
  "ledger_accounts",
  {
    id: text("id").primaryKey(),
    kind: text("kind").$type<AccountKind>().notNull(),
    owner: text("owner"), // username; null for platform accounts
    label: text("label").notNull(),
    currency: text("currency").notNull(), // ISO 4217
    createdAt: createdAt(),
  },
  (t) => [index("ledger_accounts_by_owner").on(t.owner, t.kind)],
);

/**
 * One row per posting. The id is deterministic (e.g. `capture:<id>`), so
 * posting the same transaction twice violates the primary key.
 */
export const ledgerTxns = pgTable(
  "ledger_txns",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(), // "payment.captured", "settlement", …
    owner: text("owner"), // the username this transaction concerns
    ref: text("ref"), // "invoice:<id>"
    memo: text("memo"),
    createdAt: createdAt(),
  },
  (t) => [index("ledger_txns_recent").on(t.owner, t.createdAt)],
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: text("id").primaryKey(),
    txnId: text("txn_id")
      .notNull()
      .references(() => ledgerTxns.id),
    account: text("account")
      .notNull()
      .references(() => ledgerAccounts.id),
    debitMinor: minor("debit_minor").notNull().default("0"),
    creditMinor: minor("credit_minor").notNull().default("0"),
    currency: text("currency").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("ledger_entries_by_txn").on(t.txnId),
    index("ledger_entries_by_account").on(t.account, t.createdAt),
  ],
);

export type PaymentStatus = "created" | "captured" | "failed";

/**
 * One attempt to pay through a provider. `orderId` is unique, so a PayPal
 * order always maps back to exactly one invoice; `captureId` is unique, so
 * the same capture is never counted twice.
 */
export const payments = pgTable(
  "payments",
  {
    id: text("id").primaryKey(), // sent to the provider as custom_id
    invoiceId: text("invoice_id").notNull(),
    owner: text("owner").notNull(), // username being paid
    provider: text("provider").$type<"paypal">().notNull(),
    orderId: text("order_id").notNull().unique(),
    captureId: text("capture_id").unique(),
    status: text("status").$type<PaymentStatus>().notNull(),
    amountMinor: minor("amount_minor").notNull(), // asked for
    capturedMinor: minor("captured_minor"), // gross actually received
    feeMinor: minor("fee_minor"), // what the provider kept
    currency: text("currency").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("payments_by_invoice").on(t.invoiceId),
    index("payments_by_owner").on(t.owner, t.createdAt),
  ],
);

/**
 * An inbound provider event, stored before it is processed. `event_id` is
 * the primary key, so a redelivery never takes effect twice.
 */
export const webhookEvents = pgTable("webhook_events", {
  eventId: text("event_id").primaryKey(),
  provider: text("provider").notNull(), // "paypal"
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type OutboxStatus = "pending" | "working" | "done" | "failed";

/** Work written in the same transaction as its cause, run later by a worker. */
export const outbox = pgTable(
  "outbox",
  {
    id: text("id").primaryKey(),
    topic: text("topic").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").$type<OutboxStatus>().notNull(),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastError: text("last_error"),
    createdAt: createdAt(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [index("outbox_ready").on(t.status, t.availableAt)],
);

export type UserRow = typeof users.$inferSelect;
export type ProfileRow = typeof profiles.$inferSelect;
export type PaymentLinkRow = typeof paymentLinks.$inferSelect;
export type InvoiceRow = typeof invoices.$inferSelect;
export type PaymentRequestRow = typeof paymentRequests.$inferSelect;
export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type WebhookRow = typeof webhooks.$inferSelect;
export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;
export type NotificationSettingsRow = typeof notificationSettings.$inferSelect;
/**
 * How an owner divides money that arrives. `target` names where a share
 * goes — "tax_reserve", "platform_fee", "merchant_payable" or "pos:<slug>" —
 * and the engine in `features/split` turns these into ledger postings.
 */
export const splitRules = pgTable(
  "split_rules",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(), // username
    name: text("name").notNull(),
    target: text("target").notNull(),
    kind: text("kind").$type<"percent" | "fixed">().notNull(),
    // Basis points for a percent (2500 = 25%), minor units for a fixed cut.
    value: minor("value").notNull(),
    priority: integer("priority").notNull(),
    state: text("state").$type<"active" | "archived">().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("split_rules_by_owner").on(t.owner, t.priority)],
);

/**
 * Money given back to a payer. One row per PayPal refund, keyed by PayPal's
 * own refund id, so a webhook redelivery and a retry both land on the same
 * row and the ledger is touched once.
 */
/**
 * A Telegram chat an owner approves from. One row per owner: the code is
 * what they send the bot to prove the chat is theirs, and it stops working
 * the moment it is used.
 */
export const telegramLinks = pgTable("telegram_links", {
  owner: text("owner").primaryKey(),
  /** Single use. Null once the chat is linked. */
  code: text("code").unique(),
  /** Telegram's chat id, as a string: they are larger than an int. */
  chatId: text("chat_id").unique(),
  linkedAt: timestamp("linked_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type RefundStatus = "pending" | "completed" | "failed";

export const refunds = pgTable(
  "refunds",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    paymentId: text("payment_id").notNull(),
    invoiceId: text("invoice_id").notNull(),
    captureId: text("capture_id").notNull(),
    /** PayPal's refund id. The reason a replay changes nothing. */
    refundId: text("refund_id").notNull().unique(),
    /** Gross handed back to the payer. */
    amountMinor: minor("amount_minor").notNull(),
    /** What PayPal gave back of its own fee, which is often nothing. */
    feeReturnedMinor: minor("fee_returned_minor").notNull(),
    currency: text("currency").notNull(),
    /** Who asked: the owner here, or PayPal's dashboard. */
    source: text("source").$type<"owner" | "paypal">().notNull(),
    /**
     * The attempt this came from, when it started here. A retry of one
     * attempt finds this row instead of asking PayPal for a second refund.
     */
    intentKey: text("intent_key"),
    reason: text("reason"),
    status: text("status").$type<RefundStatus>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("refunds_by_owner").on(t.owner, t.createdAt),
    index("refunds_by_capture").on(t.captureId),
    index("refunds_by_invoice").on(t.invoiceId),
    uniqueIndex("refunds_one_per_attempt").on(t.paymentId, t.intentKey),
  ],
);

export type PayoutStatus = "pending" | "paid" | "failed" | "simulated";

/**
 * Money released to the merchant. `senderBatchId` is derived from the intent
 * (who, how much, and the ledger position it was requested at), so asking
 * twice for the same payout cannot send twice — PayPal replays the batch and
 * our ledger refuses the second posting.
 */
export const payouts = pgTable(
  "payouts",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    senderBatchId: text("sender_batch_id").notNull().unique(),
    destination: text("destination").notNull(), // PayPal email
    amountMinor: minor("amount_minor").notNull(),
    currency: text("currency").notNull(),
    status: text("status").$type<PayoutStatus>().notNull(),
    /** PayPal's batch id, once it has one. */
    batchId: text("batch_id"),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("payouts_by_owner").on(t.owner, t.createdAt)],
);

// ── The Guardian ─────────────────────────────────────────────────────────
// Nothing moves money without a proposal, and no proposal is decided by a
// model. These tables hold the limits, the proposals, the approvals bound to
// what they approved, and the record of all of it.

/** One row per owner; absent means the defaults in `features/guardian`. */
export const guardianPolicies = pgTable("guardian_policies", {
  owner: text("owner").primaryKey(), // username
  perTransactionMinor: minor("per_transaction_minor").notNull(),
  perDayMinor: minor("per_day_minor").notNull(),
  approveAboveMinor: minor("approve_above_minor").notNull(),
  newRecipientNeedsApproval: boolean("new_recipient_needs_approval").notNull(),
  expiryMinutes: integer("expiry_minutes").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type ProposalStatus =
  | "refused" // the Guardian said no
  | "awaiting" // the Guardian asked the owner
  | "approved" // the owner said yes, not carried out yet
  | "executed"
  | "expired"
  | "withdrawn";

export type GuardianVerdict = "allow" | "ask" | "refuse";

export const proposals = pgTable(
  "proposals",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    kind: text("kind").notNull(), // "payout"
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    /**
     * sha256 of the canonical proposal. An approval records the hash it
     * approved, so amending a proposal afterwards cannot inherit consent.
     */
    hash: text("hash").notNull(),
    status: text("status").$type<ProposalStatus>().notNull(),
    verdict: text("verdict").$type<GuardianVerdict>().notNull(),
    reason: text("reason").notNull(),
    findings: jsonb("findings").notNull(),
    /** "owner" today; an agent's name once agents write these. */
    proposedBy: text("proposed_by").notNull(),
    /** Model and prompt version behind it, when one was involved. */
    model: text("model"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("proposals_by_owner").on(t.owner, t.createdAt),
    index("proposals_waiting").on(t.status, t.expiresAt),
  ],
);

/**
 * Every act of consent, in order — a log, not a flag. Each one names the
 * hash it was given for, so consent covers one wording of a proposal and
 * not whatever that proposal becomes later.
 */
export const approvals = pgTable(
  "approvals",
  {
    id: text("id").primaryKey(),
    proposalId: text("proposal_id").notNull(),
    hash: text("hash").notNull(),
    approvedBy: text("approved_by").notNull(),
    via: text("via").$type<"app" | "telegram">().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("approvals_by_proposal").on(t.proposalId, t.createdAt)],
);

/** Everything that happened to a proposal, in the order it happened. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    proposalId: text("proposal_id"),
    action: text("action").notNull(), // proposed · decided · approved · …
    actor: text("actor").notNull(), // "owner", "guardian", an agent
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_by_owner").on(t.owner, t.createdAt)],
);

/** One thing a storefront sells. Price absent means the payer chooses. */
export type StorefrontProduct = {
  id: string;
  name: string;
  description: string;
  /** null means the payer names the amount, within the bounds below. */
  priceMinor: string | null;
  minMinor: string | null;
  maxMinor: string | null;
  /** The payer may choose how many, up to `limit`. */
  quantity: boolean;
  limit: number;
  soldOut: boolean;
};

export type StorefrontTemplate = "shelf" | "menu" | "single" | "tip";

/**
 * A page a merchant can send people to. The agent that writes one fills in
 * this configuration, so a storefront cannot carry anything the renderer was
 * not built to show — with one exception, `html_raw`, which is the author's
 * own prose. `html_clean` beside it is what renders, and it is the only
 * thing that ever does.
 */
export const storefronts = pgTable(
  "storefronts",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(), // username
    slug: text("slug").notNull().unique(), // the public address
    title: text("title").notNull(),
    blurb: text("blurb").notNull(),
    template: text("template").$type<StorefrontTemplate>().notNull(),
    /** The look it wears; see `features/storefront/config.ts`. */
    theme: text("theme")
      .$type<"paper" | "ink" | "sun">()
      .notNull()
      .default("paper"),
    accent: text("accent").notNull().default("clay"),
    /** The author's own HTML, and the sanitised copy that is rendered. */
    htmlRaw: text("html_raw").notNull().default(""),
    htmlClean: text("html_clean").notNull().default(""),
    products: jsonb("products").$type<StorefrontProduct[]>().notNull(),
    state: text("state").$type<"draft" | "published">().notNull(),
    /** Who wrote the current draft: "owner", or an agent's name. */
    writtenBy: text("written_by").notNull(),
    currency: text("currency").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("storefronts_by_owner").on(t.owner, t.createdAt)],
);

export type LedgerAccountRow = typeof ledgerAccounts.$inferSelect;
export type LedgerTxnRow = typeof ledgerTxns.$inferSelect;
export type LedgerEntryRow = typeof ledgerEntries.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
export type OutboxRow = typeof outbox.$inferSelect;
export type SplitRuleRow = typeof splitRules.$inferSelect;
export type GuardianPolicyRow = typeof guardianPolicies.$inferSelect;
export type ProposalRow = typeof proposals.$inferSelect;
export type ApprovalRow = typeof approvals.$inferSelect;
export type PayoutRow = typeof payouts.$inferSelect;
export type StorefrontRow = typeof storefronts.$inferSelect;

/**
 * What the Advisor was asked, and what it answered from.
 *
 * The seat itself still writes nothing — this row is written by the service
 * that ran it, the way `webhook_events` is written by the route rather than
 * by the sender. Keeping the rows beside the answer is the point: an answer
 * whose rows you can no longer see is back to being a claim.
 */
export const advisorTurns = pgTable(
  "advisor_turns",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    question: text("question").notNull(),
    /** One of the six query names; never anything the model composed. */
    query: text("query").notNull(),
    /** Which of the three sources the rows came from — and so whether the
     * figures in the answer were checked at all. */
    source: text("source")
      .$type<"ledger" | "table" | "document">()
      .notNull()
      .default("ledger"),
    why: text("why").notNull(),
    caption: text("caption").notNull(),
    rows: jsonb("rows").$type<Record<string, string>[]>().notNull(),
    answer: text("answer").notNull(),
    model: text("model").notNull(),
    pickedBy: text("picked_by").notNull(),
    tookMs: integer("took_ms").notNull(),
    askedVia: text("asked_via").$type<"app" | "telegram">().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("advisor_turns_by_owner").on(t.owner, t.createdAt)],
);

export type AdvisorTurnRow = typeof advisorTurns.$inferSelect;
