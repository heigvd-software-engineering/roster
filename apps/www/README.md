# @labs/www

The labs front end: a React Router 8 **SPA** (`ssr: false`), Tailwind 4, and
shadcn/ui on Base UI. It talks to `@labs/api` over `/api/*` and renders
entirely in the browser.

There is no server here. `app/entry.server.tsx` runs **once at build time** to
prerender the static `index.html` shell — see the comment at the top of that
file. In production a single Cloudflare Worker (`apps/api`) serves this app's
static assets *and* the API from one origin.

## Running it

Prereqs: Node ≥ 22.22, pnpm 11 (auto-downloaded via `devEngines`), and
`apps/api/.dev.vars` with the dev secrets — see
[`GITHUB_APP_SETUP.md`](../../GITHUB_APP_SETUP.md).

From the repo root:

```bash
pnpm install                    # pnpm, not npm — `@labs/api: workspace:*`
                                # is a protocol npm cannot resolve

# two terminals — the SPA is useless without the API
pnpm --filter @labs/api dev     # Worker (API) on http://localhost:8788
pnpm --filter @labs/www dev     # SPA on https://localhost:3000
```

Open **`https://localhost:3000`**.

- **The port and the scheme are both load-bearing.** `vite.config.ts` pins
  `port: 3000, strictPort: true` and enables a dev-only self-signed cert
  (`basicSsl`). `https://localhost:3000` is the origin the SWITCH edu-ID client
  and the `heigvdlabs` GitHub App have registered as a redirect URI. On any
  other origin the app loads but **sign-in fails** — which reads as a bug in
  the app rather than a wrong URL.
- The browser will warn about the self-signed certificate. Accept it once.
- In dev only, Vite proxies `/api` → `http://localhost:8788`. In production the
  Worker serves both from one origin and no proxy is involved.

## Checks

```bash
pnpm --filter @labs/www test        # vitest + jsdom + testing-library (test/)
pnpm --filter @labs/www typecheck   # react-router typegen && tsc
pnpm run biome                      # lint + format check, from the root
```

## Building & deploying

```bash
pnpm --filter @labs/www build       # → build/client (ships), build/server (see below)
```

`build/server/` is a build-time artifact, not a deployable server: SPA mode
still emits a server entry to prerender the shell. Only `build/client/` ships.

`apps/www` is **not deployed on its own**. `apps/api/wrangler.jsonc` binds
`../www/build/client` as the Worker's assets directory, so deploying the API
ships whatever this build last produced:

```bash
pnpm --filter @labs/www build
pnpm --filter @labs/api run deploy:demo    # or deploy:prod
```

Always rebuild before deploying — the Worker ships the contents of
`build/client` at that moment, not the contents of your git tree. Full guide:
[`DEPLOY.md`](../../DEPLOY.md) (Cloudflare, D1, secrets, GitHub App, SWITCH
redirect URIs).

> Windows gotcha: a running Worker (`preview`) locks `build/client` — stop it
> and any lingering `workerd` process before rebuilding.

## Layout

```
app/
├─ root.tsx      # document, theme bootstrap, providers, <AppLayout>
├─ routes.ts     # route table          routes/ = thin auth/routing glue
├─ pages/        # one component per screen; fetch their own data, take no props
├─ components/   # ui/ (generated) + custom/ (ours) — see components/README.md
├─ contexts/     # auth, message, theme providers
├─ lib/          # api client (hc<AppType>), auth client, identity, cn, …
└─ app.css       # design tokens (:root / .dark / .terminal)
```

Import alias: `~/*` → `./app/*`.
