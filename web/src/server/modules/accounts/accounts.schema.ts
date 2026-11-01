import { z } from "zod";

const hexBytes = (bytes: number, label: string) =>
  z
    .string()
    .length(bytes * 2, `${label} must be ${bytes} bytes`)
    .regex(/^[0-9a-fA-F]+$/, `${label} must be hexadecimal`)
    .transform((v) => v.toLowerCase());

// nonce(12) ‖ AES-256-GCM(master 32) ‖ tag(16)
export const escrowInput = z
  .object({
    encryptedMasterHex: hexBytes(60, "encrypted master"),
    masterSaltHex: hexBytes(16, "master salt"),
    kdfParams: z
      .object({
        m: z.number().int().min(8).max(262_144),
        t: z.number().int().min(1).max(10),
        p: z.number().int().min(1).max(16),
      })
      .strict(),
  })
  .strict();

const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const escrowOutput = escrowInput.extend({ revision }).nullable();
export const rotateEscrowInput = z
  .object({ expectedRevision: revision, escrow: escrowInput })
  .strict();

export const passkeyInput = z
  .object({
    credentialId: z
      .string()
      .min(16)
      .max(1400)
      .regex(/^[A-Za-z0-9_-]+$/, "credential id must be base64url"),
    transports: z.array(z.string().min(1).max(32)).max(10).default([]),
    signPubkeyHex: hexBytes(32, "signing pubkey"),
  })
  .strict();

/** How the account is used: it picks the tools the dashboard puts first. */
export const accountTypeSchema = z.enum(["personal", "freelancer", "business"]);

export const setAccountTypeInput = z
  .object({
    accountType: accountTypeSchema,
    // Shown on the owner's own screens (e.g. the point of sale), not published.
    businessName: z.string().trim().max(60).nullable().default(null),
  })
  .strict();

export const accountTypeOutput = z.object({
  accountType: accountTypeSchema.nullable(),
  businessName: z.string().nullable(),
});

export const meOutput = z
  .object({
    recovery: z.enum(["passkey", "pin"]).nullable(),
    passkey: passkeyInput.nullable(),
    username: z.string().nullable(),
  })
  .merge(accountTypeOutput);

export type EscrowInput = z.infer<typeof escrowInput>;
export type EscrowOutput = z.infer<typeof escrowOutput>;
export type RotateEscrowInput = z.infer<typeof rotateEscrowInput>;
export type PasskeyInput = z.infer<typeof passkeyInput>;
export type MeOutput = z.infer<typeof meOutput>;
export type AccountType = z.infer<typeof accountTypeSchema>;
export type SetAccountTypeInput = z.infer<typeof setAccountTypeInput>;
export type AccountTypeOutput = z.infer<typeof accountTypeOutput>;
