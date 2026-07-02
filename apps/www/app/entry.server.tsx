/**
 * Server entry — renders the app's HTML to a stream.
 *
 * We run `ssr: false` (see react-router.config.ts), so this does NOT run
 * per-request in production. It executes ONCE at BUILD TIME to prerender the
 * static index.html shell; at runtime the Worker just serves that shell + JS
 * and React renders in the browser. The file exists only because React Router 8
 * still requires a server entry even in SPA mode (removing it breaks
 * `react-router build`/`typegen`). We don't expect to ever need real SSR.
 */
import { renderToReadableStream } from "react-dom/server";
import type { EntryContext } from "react-router";
import { ServerRouter } from "react-router";

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
) {
  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    { signal: request.signal },
  );

  await body.allReady;

  responseHeaders.set("Content-Type", "text/html");

  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}
