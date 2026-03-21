"use client";

import useSWR from "swr";
import type { SWRConfiguration, SWRResponse } from "swr";
import { useAgentPlaneClient, useAuthError } from "./use-client";
import type { AgentPlaneClient } from "../types";

/**
 * Thin wrapper around SWR that automatically injects the AgentPlane SDK client
 * into the fetcher function.
 *
 * ```ts
 * const { data, error } = useApi("agents", (client) => client.agents.list());
 * ```
 *
 * Pass `null` as the key to skip fetching (conditional fetching).
 */
export function useApi<T = unknown>(
  key: string | null,
  fetcher: (client: AgentPlaneClient) => Promise<T>,
  options?: SWRConfiguration<T>,
): SWRResponse<T> {
  const client = useAgentPlaneClient();
  const onAuthError = useAuthError();

  return useSWR<T>(
    key,
    () => fetcher(client),
    {
      revalidateOnFocus: false,
      errorRetryCount: 3,
      onError: (err) => {
        if (onAuthError && err && typeof err === "object" && "status" in err && (err as { status: number }).status === 401) {
          onAuthError(err instanceof Error ? err : new Error(String(err)));
        }
      },
      ...options,
    },
  );
}
