import { createMiddleware } from "hono/factory";
import type { Env } from "../../env";

/** The three hosts RFC 8252 §7.3 calls loopback, and the only ones the OAuth
 *  provider accepts over plain http. `new URL()` reports the v6 literal with
 *  its brackets, which is the form the provider matches too. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** A redirect URI that only a native app could have: plain http, on a port the
 *  app opened on this machine. Anything else — https, a real host, a private-use
 *  scheme — is left for the provider to judge. */
function isHttpLoopback(uri: unknown): boolean {
  if (typeof uri !== "string") return false;
  try {
    const url = new URL(uri);
    return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Declare a registering client `native` when its redirect URIs say it is one.
 *
 * OIDC registration defaults `application_type` to `web`, and a web client may
 * not use a loopback redirect: `@better-auth/oauth-provider` refuses one with
 * `400 invalid_redirect_uri`. Every MCP client is in exactly that position. The
 * MCP SDK's registration metadata (`OAuthClientMetadataSchema`, 1.30.0 — the
 * current release) has no `application_type` field and `.strip()`s unknown
 * keys, so no client built on it can send the value that would let it register,
 * and it registers `http://127.0.0.1:<port>/callback` because that is what a
 * CLI or a desktop app can listen on. Without this, decision #6 — every
 * shipping MCP client registers itself — is unreachable.
 *
 * So the value is supplied from the only evidence there is, and RFC 8252 §7.3
 * is unambiguous about what that evidence means: an http loopback redirect is a
 * native app's redirect. The rewrite is narrow on purpose:
 *
 * - only when the client sent no `application_type` of its own,
 * - only when *every* redirect URI is http loopback, so a mixed registration is
 *   never quietly reclassified.
 *
 * It cannot loosen anything: the provider validates the URIs itself afterwards,
 * and the `native` branch it then takes is *stricter* than `web` about https
 * loopback while being the branch http loopback belongs in. What this changes
 * is which branch runs, not whether one does.
 *
 * Remove the day the provider exposes a default application type — the value
 * lives in an internal helper (`applyOAuthClientRegistrationDefaults`) with no
 * option plumbed to it, which is the only reason this is here.
 */
export const declareNativeLoopbackClients = createMiddleware<Env>(
  async (c, next) => {
    if (c.req.method !== "POST") return next();

    let body: unknown;
    try {
      body = await c.req.raw.clone().json();
    } catch {
      // Not JSON, so not a registration we understand. The provider answers.
      return next();
    }
    if (typeof body !== "object" || body === null) return next();

    // Only the two fields this decision turns on are named; everything else
    // rides through untouched for the provider's own schema to judge.
    const metadata = body as {
      application_type?: unknown;
      redirect_uris?: unknown;
    };
    if (metadata.application_type !== undefined) return next();

    const redirectUris = metadata.redirect_uris;
    if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
      return next();
    }
    if (!redirectUris.every(isHttpLoopback)) return next();

    const headers = new Headers(c.req.raw.headers);
    // The body is about to grow; a stale length would truncate it.
    headers.delete("content-length");
    c.req.raw = new Request(c.req.raw.url, {
      method: c.req.raw.method,
      headers,
      body: JSON.stringify({ ...metadata, application_type: "native" }),
    });

    return next();
  },
);
