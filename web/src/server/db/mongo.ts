import { type Collection, type Db, MongoClient } from "mongodb";
import { getServerEnv } from "../../env.server";

/** One account per Privy identity. Holds recovery metadata, never keys. */
export type UserDoc = {
  _id: string; // Privy user id
  email?: string;
  // PIN escrow: the account master encrypted under Argon2id(PIN).
  escrow?: {
    encryptedMasterHex: string;
    masterSaltHex: string;
    kdfParams: { m: number; t: number; p: number };
    revision: number;
  };
  // Passkey recovery (PRF). Public data only: which credential to ask for and
  // the profile signing key its master must reproduce.
  passkey?: {
    credentialId: string;
    transports: string[];
    signPubkeyHex: string;
  };
  // Chosen at onboarding; decides which tools the dashboard shows first.
  accountType?: "personal" | "freelancer" | "business";
  businessName?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Public profile: @username → this account's keys, signed by its owner. */
export type ProfileDoc = {
  _id: string; // lowercase username
  userId: string; // Privy user id
  signPubkeyHex: string; // Ed25519
  msgPubkeyHex: string; // X25519
  claimJson: string; // canonical JSON of the signed claim
  claimSigHex: string;
  createdAt: Date;
};

export type PaymentLinkDoc = {
  _id: string; // public id (base62)
  owner: string; // username
  slug: string;
  title: string;
  description: string | null;
  amountMinor: string | null; // null = payer chooses
  currency: string; // ISO 4217
  state: "active" | "archived";
  createdAt: Date;
  updatedAt: Date;
};

export type InvoiceItem = {
  description: string;
  quantity: number;
  unitMinor: string; // minor units of the invoice currency
};

export type InvoiceDoc = {
  _id: string; // public id (base62)
  owner: string; // username
  number: string;
  token: string; // public capability for /i/<token>
  clientName: string;
  clientEmail: string | null;
  items: InvoiceItem[];
  totalMinor: string;
  currency: string; // ISO 4217
  notes: string;
  dueDate: string; // YYYY-MM-DD
  status: "pending" | "paid" | "void";
  // Created through the merchant API (a checkout) with their order reference.
  source?: "dashboard" | "api";
  reference?: string | null;
  // Recurring series: only the newest invoice keeps the schedule.
  recurrence?: "none" | "weekly" | "monthly";
  nextIssueAt?: Date | null;
  seriesNumber?: string; // number of the first invoice in the series
  seriesIndex?: number; // 1 for the first invoice
  reminderSentAt?: Date | null;
  paidMinor: string;
  paidReportedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Merchant API key. Only a hash of the secret is stored. */
export type ApiKeyDoc = {
  _id: string; // key id, part of the key
  owner: string;
  name: string;
  secretHash: string; // sha256 hex of the full key
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

/** Where to POST signed events for `owner` (one endpoint per account). */
export type WebhookDoc = {
  _id: string; // owner username
  url: string;
  secret: string; // HMAC key, shown to the owner to verify signatures
  createdAt: Date;
  updatedAt: Date;
};

export type WebhookDeliveryDoc = {
  _id: string;
  owner: string;
  event: string;
  status: "delivered" | "failed";
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  createdAt: Date;
};

export type SealedDoc = { epk: string; nonce: string; ct: string };

/**
 * A payment request from one @username to another. Amount and note are
 * sealed to each party's messaging key; the server sees only who asked whom.
 */
export type PaymentRequestDoc = {
  _id: string; // public id (base62)
  from: string; // requester username (gets paid)
  to: string; // payer username
  forPayer: SealedDoc;
  forRequester: SealedDoc;
  status: "pending" | "paid" | "declined" | "cancelled";
  createdAt: Date;
  updatedAt: Date;
};

export type NotificationSettingsDoc = {
  _id: string; // Privy user id
  email: string;
  enabled: boolean;
  events: {
    invoicePaid: boolean;
    paymentPing: boolean;
    requestReceived: boolean;
  };
  unsubscribeToken: string;
  createdAt: Date;
  updatedAt: Date;
};

export type NotificationLogDoc = {
  _id: string; // unique event key, e.g. "invoice-paid:<id>"
  recipientEmail: string;
  eventType:
    | "invoicePaid"
    | "invoiceIssued"
    | "invoiceReminder"
    | "paymentPing"
    | "requestReceived"
    | "test";
  sentAt: Date;
};

declare global {
  // eslint-disable-next-line no-var
  var _appMongoClientPromise: Promise<MongoClient> | undefined;
}

let clientPromise: Promise<MongoClient> | undefined;

function getClient(): Promise<MongoClient> {
  if (clientPromise) return clientPromise;

  const serverEnv = getServerEnv();
  const configuredUri = serverEnv.MONGODB_URI;
  if (serverEnv.NODE_ENV === "production" && !configuredUri) {
    throw new Error("MONGODB_URI must be configured in production.");
  }
  const uri = configuredUri || "mongodb://localhost:27017/app";

  if (serverEnv.NODE_ENV === "development") {
    // Reuse the connection across HMR reloads in dev.
    global._appMongoClientPromise ??= new MongoClient(uri).connect();
    clientPromise = global._appMongoClientPromise;
  } else {
    clientPromise = new MongoClient(uri).connect();
  }
  // Don't cache a failed connect, or one Mongo outage breaks every later request.
  clientPromise.catch(() => {
    clientPromise = undefined;
    global._appMongoClientPromise = undefined;
  });
  return clientPromise;
}

export async function getDb(): Promise<Db> {
  return (await getClient()).db(); // database name from the URI path
}

const collection =
  <T extends { _id: string }>(name: string) =>
  async (): Promise<Collection<T>> =>
    (await getDb()).collection<T>(name);

export const getUsers = collection<UserDoc>("users");
export const getProfiles = collection<ProfileDoc>("profiles");
export const getPaymentLinks = collection<PaymentLinkDoc>("payment_links");
export const getInvoices = collection<InvoiceDoc>("invoices");
export const getPaymentRequests =
  collection<PaymentRequestDoc>("payment_requests");
export const getNotificationSettings = collection<NotificationSettingsDoc>(
  "notification_settings",
);
export const getApiKeys = collection<ApiKeyDoc>("api_keys");
export const getWebhooks = collection<WebhookDoc>("webhooks");
export const getWebhookDeliveries =
  collection<WebhookDeliveryDoc>("webhook_deliveries");
export const getNotificationLogs =
  collection<NotificationLogDoc>("notification_logs");
