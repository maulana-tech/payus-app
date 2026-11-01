import type { inferRouterOutputs } from "@trpc/server";
import { accountsRouter } from "./modules/accounts/accounts.router";
import { developerRouter } from "./modules/developer/developer.router";
import { invoicesRouter } from "./modules/invoices/invoices.router";
import { notificationsRouter } from "./modules/notifications/notifications.router";
import { paymentLinksRouter } from "./modules/paymentLinks/paymentLinks.router";
import { profilesRouter } from "./modules/profiles/profiles.router";
import { requestsRouter } from "./modules/requests/requests.router";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  accounts: accountsRouter,
  profiles: profilesRouter,
  paymentLinks: paymentLinksRouter,
  invoices: invoicesRouter,
  requests: requestsRouter,
  developer: developerRouter,
  notifications: notificationsRouter,
});

export type AppRouter = typeof appRouter;

export type RouterOutputs = inferRouterOutputs<AppRouter>;
