import { expect, test } from "vitest";
import wranglerDemoJsonc from "../wrangler.demo.jsonc?raw";
// Vite resolves these at transform time, so the workers pool never touches the
// filesystem: the sources arrive as strings inside the bundle.
import wranglerJsonc from "../wrangler.jsonc?raw";

const handlerSources = import.meta.glob("../src/handlers/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const libSources = import.meta.glob("../src/lib/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// Board test 9.4 (R9): nothing imports from `src/mcp/` into `handlers/` or
// `lib/` — except `lib/mcp/`, which exists to. The rule is what keeps moving
// /mcp to its own Worker a change of transport rather than a rewrite.
test("no import from src/mcp/ leaks into handlers/ or lib/ (lib/mcp aside)", () => {
  // A silent glob would make this test vacuous.
  expect(Object.keys(handlerSources).length).toBeGreaterThan(5);
  expect(Object.keys(libSources).some((f) => f.includes("/lib/mcp/"))).toBe(
    true,
  );
  const offenders: string[] = [];
  const importsFromMcp = /from\s+["'][^"']*\/mcp\/(?:tools|[^"']*)["']/;
  for (const [file, source] of [
    ...Object.entries(handlerSources),
    ...Object.entries(libSources),
  ]) {
    if (file.includes("/lib/mcp/")) continue;
    if (importsFromMcp.test(source)) offenders.push(file);
  }
  expect(offenders).toEqual([]);
});

// Board test 9.8 (R7): the lane is stateless — the day a Durable Object or a
// KV namespace appears in a wrangler config, this fails and the change has to
// argue for itself.
test("wrangler configs hold no Durable Object and no KV", () => {
  for (const config of [wranglerJsonc, wranglerDemoJsonc]) {
    expect(config).not.toContain("durable_objects");
    expect(config).not.toContain("kv_namespaces");
  }
});
