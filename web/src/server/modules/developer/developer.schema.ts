import { z } from "zod";
import { CURRENCIES } from "../../../features/invoices/money";

export const createKeyInput = z
  .object({ name: z.string().trim().min(1).max(60) })
  .strict();

export const keyIdInput = z
  .object({ id: z.string().regex(/^[0-9a-f]{12}$/) })
  .strict();

export const webhookInput = z
  .object({ url: z.string().trim().url().max(500) })
  .strict();

/** Body of POST /api/v1/checkouts. */
export const checkoutInput = z
  .object({
    amount: z
      .string()
      .trim()
      .regex(/^\d{1,12}(\.\d{1,2})?$/),
    currency: z.enum(CURRENCIES).default("USD"),
    description: z.string().trim().max(200).default(""),
    reference: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._:#/-]{1,64}$/)
      .optional(),
    customer_name: z.string().trim().max(120).optional(),
    customer_email: z.string().trim().email().max(200).optional(),
    due_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();

export type CheckoutInput = z.infer<typeof checkoutInput>;

export type CheckoutStatus = "open" | "partially_paid" | "paid" | "void";

/** What the API returns and what webhooks carry. */
export type CheckoutView = {
  id: string;
  object: "checkout";
  status: CheckoutStatus;
  currency: string; // ISO 4217
  amount: string; // decimal in `currency`
  amount_minor: string; // integer minor units
  paid_minor: string;
  reference: string | null;
  description: string;
  url: string;
  embed_url: string;
  created_at: string;
  paid_reported_at: string | null;
};
