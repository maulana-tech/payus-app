import { z } from "zod";
import { usernameSchema } from "../profiles/profiles.schema";

const hex = (min: number, max: number) =>
  z
    .string()
    .regex(/^[0-9a-f]+$/)
    .min(min)
    .max(max);

export const sealedSchema = z
  .object({ epk: hex(64, 64), nonce: hex(24, 24), ct: hex(34, 2400) })
  .strict();

export const requestId = z.string().regex(/^[0-9A-Za-z]{8,24}$/);

export const createRequestInput = z
  .object({
    id: requestId,
    to: usernameSchema,
    forPayer: sealedSchema,
    forRequester: sealedSchema,
  })
  .strict();

export const requestIdInput = z.object({ id: requestId }).strict();

export const markPaidInput = requestIdInput;

export const requestOutput = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  sealed: sealedSchema, // the caller's own copy
  status: z.enum(["pending", "paid", "declined", "cancelled"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** What both parties decrypt from their sealed copy. */
export type RequestPayload = { amountMinor: string; note: string };

export type CreateRequestInput = z.infer<typeof createRequestInput>;
export type MarkPaidInput = z.infer<typeof markPaidInput>;
export type RequestOutput = z.infer<typeof requestOutput>;
