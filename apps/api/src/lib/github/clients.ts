import { App, Octokit } from "octokit";
import type { AuthEnv } from "../auth/config";

// FOLDER-INTERNAL: only the operation modules in github/ import these
// factories. Routes compose the named operations instead (see README.md).

/**
 * Workers-safe Octokit. The `octokit` package bundles the retry + throttling
 * plugins, whose bottleneck timers resolve promises ACROSS request contexts —
 * the Workers runtime cancels those ("code had hung and would never generate
 * a response"), so the first request works and every later GitHub call hangs.
 * Disable both; we keep pagination (pure) and already contain failures
 * per-operation instead of retrying.
 */
export const WorkersOctokit = Octokit.defaults({
  throttle: { enabled: false },
  retry: { enabled: false },
});

/**
 * The GitHub App (server-to-server). Workers-compatible: the App JWT is signed
 * with Web Crypto — which requires the key in **PKCS#8** (`BEGIN PRIVATE
 * KEY`), NOT GitHub's default PKCS#1 (`BEGIN RSA PRIVATE KEY`). Convert once when
 * setting the secret (see GITHUB_APP_SETUP.md). The secret is stored single-line
 * with `\n`, so normalize to real newlines here.
 */
function createAppClient(env: AuthEnv): App {
  return new App({
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n"),
    Octokit: WorkersOctokit,
  });
}

/** App-JWT client — for App-level reads like GET /app/installations/{id}. */
export function appJwtOctokit(env: AuthEnv) {
  return createAppClient(env).octokit;
}

/**
 * Installation tokens cached per isolate (they live 1h; we renew 5 min
 * early). Without this, EVERY operation minted its own token — one extra
 * GitHub round-trip per call. Only the token STRING is cached, never a
 * client or an in-flight promise: Workers forbids sharing I/O (pending
 * fetches) across request contexts, while a string is inert.
 */
const installationTokens = new Map<
  number,
  { token: string; expiresAt: number }
>();

/** Installation-scoped client — for org reads/writes with least privilege. */
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
