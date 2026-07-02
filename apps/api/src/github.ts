import { App } from "@octokit/app";
import type { AuthEnv } from "./auth";

/** The GitHub App (server-to-server). Workers-compatible: @octokit/app signs
 *  the App JWT with Web Crypto. */
export function createAppClient(env: AuthEnv): App {
  return new App({
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
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
