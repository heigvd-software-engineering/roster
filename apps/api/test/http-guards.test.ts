import { Hono } from "hono";
import { expect, test } from "vitest";
import type { Env } from "../src/env";
import { rateLimit } from "../src/lib/http/rate-limit";
import { requireSameOrigin } from "../src/lib/http/same-origin";
import { apiSecurityHeaders } from "../src/lib/http/security-headers";

// The HTTP-layer guards, exercised as a browser would meet them. They sit ahead
// of every route module (src/index.ts), so what they let through and what they
// refuse is a property of the whole API, not of any one handler.

const ORIGIN = "https://roster.example";
const bindings = { BETTER_AUTH_URL: ORIGIN } as Env["Bindings"];

const app = new Hono<Env>()
  // Mounted exactly as src/index.ts mounts them.
  .use("/api/*", apiSecurityHeaders, requireSameOrigin)
  .get("/api/thing", (c) => c.json({ ok: true }))
  .post("/api/thing", (c) => c.json({ ok: true }));

const call = (path: string, init?: RequestInit) =>
  app.request(path, init, bindings);

/** The limiter on its own — the two tests below differ only in the bindings. */
const limited = new Hono<Env>()
  .use("/api/*", rateLimit("AUTH_LIMITER"))
  .get("/api/thing", (c) => c.json({ ok: true }));

test("a same-origin write passes", async () => {
  const res = await call("/api/thing", {
    method: "POST",
    headers: { Origin: ORIGIN, "Sec-Fetch-Site": "same-origin" },
  });
  expect(res.status).toBe(200);
});

test("a cross-origin write is refused", async () => {
  const res = await call("/api/thing", {
    method: "POST",
    headers: { Origin: "https://evil.example" },
  });
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "cross_origin" });
});

test("the browser's own cross-site verdict is enough, with no Origin", async () => {
  const res = await call("/api/thing", {
    method: "POST",
    headers: { "Sec-Fetch-Site": "cross-site" },
  });
  expect(res.status).toBe(403);
});

test("a caller that sends no Origin at all passes — not what CSRF is", async () => {
  const res = await call("/api/thing", { method: "POST" });
  expect(res.status).toBe(200);
});

test("reads are never refused, whatever the origin", async () => {
  const res = await call("/api/thing", {
    headers: { Origin: "https://evil.example" },
  });
  expect(res.status).toBe(200);
});

test("every API response carries the security headers", async () => {
  const res = await call("/api/thing");
  expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  expect(res.headers.get("Content-Security-Policy")).toContain(
    "frame-ancestors 'none'",
  );
});

test("a refusal carries them too", async () => {
  const res = await call("/api/thing", {
    method: "POST",
    headers: { Origin: "https://evil.example" },
  });
  expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
});

test("the rate limiter answers 429 when the binding says so", async () => {
  const withLimiter = {
    ...bindings,
    AUTH_LIMITER: { limit: async () => ({ success: false }) },
  } as unknown as Env["Bindings"];

  const res = await limited.request("/api/thing", undefined, withLimiter);
  expect(res.status).toBe(429);
  expect(await res.json()).toEqual({ error: "rate_limited" });
});

test("an ABSENT limiter binding means no limit, never a crash", async () => {
  // `wrangler dev` and the test pool both run without it; production must not
  // be the only configuration that boots.
  const res = await limited.request("/api/thing", undefined, bindings);
  expect(res.status).toBe(200);
});
