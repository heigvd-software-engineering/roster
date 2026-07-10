import { afterEach, expect, test, vi } from "vitest";
import {
  fetchGithubProfile,
  GithubUnavailableError,
} from "../src/lib/github/user";

/**
 * The null/throw contract (unavailability fix, 2026-07-09): `null` means
 * exactly ONE thing — GitHub answered 401, the token is dead, (re)linking is
 * the right next step. EVERY other failure throws GithubUnavailableError so
 * an outage can never read as "not linked" and bounce a healthy user through
 * onboarding.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(impl: () => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

test("maps a 200 into the narrowed profile", async () => {
  stubFetch(async () =>
    Response.json({
      login: "octocat",
      id: 583231,
      name: "The Octocat",
      avatar_url: "http://a",
    }),
  );
  expect(await fetchGithubProfile("tok")).toEqual({
    login: "octocat",
    id: 583231,
    name: "The Octocat",
    avatarUrl: "http://a",
  });
});

test("401 — a dead token — is null: the ONE 're-link' signal", async () => {
  stubFetch(async () =>
    Response.json({ message: "Bad credentials" }, { status: 401 }),
  );
  expect(await fetchGithubProfile("tok")).toBeNull();
});

test("a 5xx throws unavailable, never null", async () => {
  stubFetch(async () => Response.json({}, { status: 502 }));
  await expect(fetchGithubProfile("tok")).rejects.toBeInstanceOf(
    GithubUnavailableError,
  );
});

test("a rate limit (403) throws unavailable — ambiguity never means 'unlinked'", async () => {
  stubFetch(async () =>
    Response.json({ message: "API rate limit exceeded" }, { status: 403 }),
  );
  await expect(fetchGithubProfile("tok")).rejects.toBeInstanceOf(
    GithubUnavailableError,
  );
});

test("a network fault throws unavailable", async () => {
  stubFetch(async () => {
    throw new TypeError("fetch failed");
  });
  await expect(fetchGithubProfile("tok")).rejects.toBeInstanceOf(
    GithubUnavailableError,
  );
});

test("an unreadable body throws unavailable", async () => {
  stubFetch(async () => new Response("<!doctype html>", { status: 200 }));
  await expect(fetchGithubProfile("tok")).rejects.toBeInstanceOf(
    GithubUnavailableError,
  );
});
