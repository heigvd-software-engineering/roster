import { Hono } from "hono";
import { expect, test, vi } from "vitest";
import { requireAuth } from "../src/lib/auth/require-auth";

vi.mock("../src/lib/auth/config", () => ({
  createAuth: () => ({
    api: {
      getSession: async ({ headers }: { headers: Headers }) =>
        headers.get("x-test-user")
          ? { user: { id: headers.get("x-test-user") } }
          : null,
    },
  }),
}));

const app = new Hono()
  .use("/p", requireAuth)
  .get("/p", (c) => c.json({ id: c.get("user").id }));

test("401 without a session", async () => {
  const res = await app.request("/p");
  expect(res.status).toBe(401);
});

test("passes the user through when signed in", async () => {
  const res = await app.request("/p", { headers: { "x-test-user": "u1" } });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ id: "u1" });
});
