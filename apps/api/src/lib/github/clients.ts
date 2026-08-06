import { App, Octokit } from "octokit";
import type { AuthEnv } from "../auth/config";

// Folder-internal: only the operation modules in github/ import these
// factories. Routes compose the named operations instead (see README.md).

/**
 * Workers-safe Octokit. The `octokit` package bundles the retry and throttling
 * plugins, whose bottleneck timers resolve promises across request contexts.
 * The Workers runtime cancels those ("code had hung and would never generate a
 * response"), so the first request works and every later GitHub call hangs.
 * Disable both; pagination stays (it is pure) and failures are already
 * contained per operation instead of retried.
 */
export const WorkersOctokit = Octokit.defaults({
  throttle: { enabled: false },
  retry: { enabled: false },
});

/**
 * The GitHub App (server-to-server). Web Crypto signs the App JWT and needs the
 * key in **PKCS#8** (`BEGIN PRIVATE KEY`), not GitHub's default PKCS#1 (`BEGIN
 * RSA PRIVATE KEY`). Convert once when setting the secret (see DEPLOY.md,
 * phase 3). The secret is stored single-line with `\n`, so
 * normalize to real newlines here.
 */
function createAppClient(env: AuthEnv): App {
  return new App({
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n"),
    Octokit: WorkersOctokit,
  });
}

/** App-JWT client, for App-level reads like GET /app/installations/{id}. */
export function appJwtOctokit(env: AuthEnv) {
  return createAppClient(env).octokit;
}

/**
 * Installation tokens cached per isolate (they live 1h; we renew 5 min early).
 * Without this, every operation minted its own token, one extra GitHub
 * round-trip per call. Only the token string is cached, never a client or an
 * in-flight promise: Workers forbids sharing I/O (pending fetches) across
 * request contexts, while a string is inert.
 */
const installationTokens = new Map<
  number,
  { token: string; expiresAt: number }
>();

/** Installation-scoped client, for org reads and writes at least privilege. */
export async function installationOctokit(
  env: AuthEnv,
  installationId: number,
) {
  const cached = installationTokens.get(installationId);
  if (cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) {
    return new WorkersOctokit({ auth: cached.token });
  }
  const { data } = await appJwtOctokit(env).request(
    "POST /app/installations/{installation_id}/access_tokens",
    { installation_id: installationId },
  );
  installationTokens.set(installationId, {
    token: data.token,
    expiresAt: Date.parse(data.expires_at),
  });
  return new WorkersOctokit({ auth: data.token });
}
