// Vite transform-time imports used by test/mcp-static.test.ts: `?raw` hands a
// file to the bundle as a string, `import.meta.glob` enumerates sources. Vite
// ships these shapes in `vite/client`, but vite is not a direct dependency
// here (it arrives through vitest) — and they must live in an ambient file
// with no imports, or they would not merge globally (env.d.ts is a module).
declare module "*?raw" {
  const source: string;
  export default source;
}

interface ImportMeta {
  glob(
    pattern: string,
    options?: { query?: string; import?: string; eager?: boolean },
  ): Record<string, unknown>;
}
