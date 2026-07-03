import { App } from "octokit";
import type { AuthEnv } from "../auth/config";

// FOLDER-INTERNAL: only the operation modules in github/ import these
// factories. Routes compose the named operations instead (see README.md).

/**
 * The GitHub App (server-to-server). Workers-compatible: @octokit/app signs the
 * App JWT with Web Crypto — which requires the key in **PKCS#8** (`BEGIN PRIVATE
 * KEY`), NOT GitHub's default PKCS#1 (`BEGIN RSA PRIVATE KEY`). Convert once when
 * setting the secret (see GITHUB_APP_SETUP.md). The secret is stored single-line
 * with `\n`, so normalize to real newlines here.
 */
export function createAppClient(env: AuthEnv): App {
  return new App({
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n"),
  });
}

/** App-JWT client — for App-level reads like GET /app/installations/{id}. */
export function appJwtOctokit(env: AuthEnv) {
  return createAppClient(env).octokit;
}

/** Installation-scoped client — for org reads/writes with least privilege. */
export async function installationOctokit(
  env: AuthEnv,
  installationId: number,
) {
  return createAppClient(env).getInstallationOctokit(installationId);
}
