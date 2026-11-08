import { initTRPC, TRPCError } from "@trpc/server";
import { ZodError, type ZodIssue } from "zod";
import type { Context } from "./context";

/**
 * What a field is called to the person filling it in.
 *
 * Only the ones whose own name would not do: `title` is "Name" on the shop
 * form, `slug` is the address. Everything else falls back to its own key,
 * which is usually already the word on screen.
 */
const FIELD: Record<string, string> = {
  // The editor's tab says Items, so the refusal says Item.
  products: "Items",
  items: "Items",
  slug: "Address",
  title: "Name",
  blurb: "Description",
  html: "The HTML block",
  clientName: "Client",
  clientEmail: "Client email",
  dueDate: "Due date",
  number: "Invoice number",
  unitPrice: "Price",
  amountMinor: "Amount",
  destination: "Destination",
};

/** "Item 2 · Name", "Address", or whatever the path says. */
function where(path: ZodIssue["path"]): string {
  const parts: string[] = [];
  for (let i = 0; i < path.length; i++) {
    const key = path[i];
    if (typeof key === "number") continue;
    const next = path[i + 1];
    // An unmapped key is usually already the word on screen; it just has
    // to start like the mapped ones do.
    const raw = String(key);
    const name = FIELD[raw] ?? raw.charAt(0).toUpperCase() + raw.slice(1);
    // A list index belongs with the list's name, not on its own.
    parts.push(
      typeof next === "number" ? `${name.replace(/s$/, "")} ${next + 1}` : name,
    );
  }
  return parts.join(" · ");
}

/**
 * A validation failure, as a sentence.
 *
 * Without this tRPC puts the whole `ZodError` through `JSON.stringify` and
 * the screen shows an array of `{ code, path, minimum }` objects. Saving a
 * shop with nothing filled in printed four of those at the person who had
 * simply not typed a name yet.
 *
 * One complaint per field: zod reports both "too short" and "wrong shape"
 * for an empty slug, and the second is noise while the first is true.
 */
export function readable(error: ZodError): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (seen.has(key)) continue;
    seen.add(key);
    const at = where(issue.path);
    lines.push(at ? `${at}: ${issue.message}` : issue.message);
  }
  return lines.join(" ") || "That is not valid.";
}

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    const cause = error.cause;
    if (!(cause instanceof ZodError)) return shape;
    return { ...shape, message: readable(cause) };
  },
});

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  // A real session must carry both the id and the verified claim. A
  // development demo session has only the id, and says so.
  if (!ctx.privyUserId || !(ctx.privyClaim || ctx.demo)) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: ctx.authError
        ? "Your Privy session is invalid or expired."
        : "Sign in with Privy to continue.",
    });
  }
  return next({
    ctx: {
      ...ctx,
      privyUserId: ctx.privyUserId,
      privyClaim: ctx.privyClaim,
    },
  });
});
