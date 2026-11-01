"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import { type ReactNode, useState } from "react";
import type { AppRouter } from "../server/root";
import { authHeader } from "./authHeader";

export const trpc = createTRPCReact<AppRouter>();

export function TRPCReactProvider({ children }: { children: ReactNode }) {
  // Data stays fresh for 30 s: remounting a screen or refocusing the tab
  // doesn't refetch everything (mutations still invalidate what they change).
  const [queryClient] = useState(
    () =>
      new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } }),
  );
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: "/api/trpc",
          headers: authHeader,
        }),
      ],
    }),
  );
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
