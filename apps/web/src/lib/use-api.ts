"use client";

import { useMemo } from "react";
import { useAuth } from "@clerk/react";
import { createApiClient } from "@/lib/api-client";

/**
 * Memoized API client bound to the current Clerk session.
 * Must be used inside <ClerkProvider> (anywhere under <Providers>).
 */
export function useApi() {
  const { getToken } = useAuth();
  return useMemo(() => createApiClient(() => getToken()), [getToken]);
}
