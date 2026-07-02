import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { SWRConfig } from "swr";
import { describe, expect, it } from "vitest";

import { type api, useApi } from "~/lib/api";

// Fresh SWR cache per render so tests don't share state.
function wrapper({ children }: PropsWithChildren) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      {children}
    </SWRConfig>
  );
}

// A stand-in hc endpoint node with a controllable status/body.
function fakeEndpoint(status: number, body: unknown, path: string) {
  return {
    $url: () => new URL(`https://test.local${path}`),
    $get: async () => ({
      ok: status < 400,
      status,
      json: async () => body,
    }),
  } as unknown as typeof api.api.me;
}

describe("useApi", () => {
  it("returns parsed data on a 2xx response", async () => {
    const { result } = renderHook(
      () => useApi(fakeEndpoint(200, { user: null }, "/api/ok")),
      { wrapper },
    );

    await waitFor(() => expect(result.current.data).toEqual({ user: null }));
    expect(result.current.error).toBeUndefined();
  });

  it("routes a non-2xx response to error, not data", async () => {
    const { result } = renderHook(
      () => useApi(fakeEndpoint(500, { error: "boom" }, "/api/fail")),
      { wrapper },
    );

    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.data).toBeUndefined();
  });
});
