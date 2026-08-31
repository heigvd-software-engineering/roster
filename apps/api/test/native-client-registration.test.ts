import { Hono } from "hono";
import { expect, test } from "vitest";
import { declareNativeLoopbackClients } from "../src/lib/auth/native-client-registration";

// Board test 9.12 (1.2c): the registration rewrite fires on an all-http-loopback
// redirect set that declared nothing, and on nothing else. The probe echoes the
// body the provider WOULD receive, so what is asserted is exactly the rewrite.

const app = new Hono()
  .use("/register", declareNativeLoopbackClients)
  .all("/register", async (c) =>
    c.req.method === "POST"
      ? c.json((await c.req.raw.json()) as Record<string, unknown>)
      : c.json({ untouched: true }),
  );

const register = (body: unknown) =>
  app.request("/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("fires: every URI is http loopback and nothing was declared", async () => {
  const res = await register({
    redirect_uris: [
      "http://127.0.0.1:33418/callback",
      "http://localhost:8080/cb",
      "http://[::1]:9999/cb",
    ],
  });
  expect(
    ((await res.json()) as { application_type?: string }).application_type,
  ).toBe("native");
});

test("does not fire when the client declared a type itself", async () => {
  const res = await register({
    application_type: "web",
    redirect_uris: ["http://127.0.0.1:33418/callback"],
  });
  expect(
    ((await res.json()) as { application_type?: string }).application_type,
  ).toBe("web");
});

test("does not fire on a mixed set — one real host taints it", async () => {
  const res = await register({
    redirect_uris: [
      "http://127.0.0.1:33418/callback",
      "https://app.example/cb",
    ],
  });
  const body = (await res.json()) as { application_type?: string };
  expect(body.application_type).toBeUndefined();
});

test("does not fire on https loopback — only plain http is the RFC 8252 signal", async () => {
  const res = await register({
    redirect_uris: ["https://127.0.0.1:33418/callback"],
  });
  expect(
    ((await res.json()) as { application_type?: string }).application_type,
  ).toBeUndefined();
});

test("does not fire on an empty or missing redirect set", async () => {
  for (const body of [{ redirect_uris: [] }, {}]) {
    const res = await register(body);
    expect(
      ((await res.json()) as { application_type?: string }).application_type,
    ).toBeUndefined();
  }
});

test("does not fire on a 127.x address that is not loopback-listed but still 127", async () => {
  // 127.0.0.2 is loopback by RFC but `new URL` reports it verbatim; the
  // middleware admits only the three RFC 8252 §7.3 literals. Stricter is safe:
  // the provider then refuses it as a web client, nothing is loosened.
  const res = await register({ redirect_uris: ["http://127.0.0.2:1234/cb"] });
  expect(
    ((await res.json()) as { application_type?: string }).application_type,
  ).toBeUndefined();
});

test("leaves non-JSON and non-POST traffic alone", async () => {
  // Non-JSON: the middleware steps aside, so the probe's own parse throws —
  // proof the body reached it unrewritten.
  const notJson = await app.request("/register", {
    method: "POST",
    body: "not json",
  });
  expect(notJson.status).toBe(500);
  const get = await app.request("/register");
  expect(await get.json()).toEqual({ untouched: true });
});
