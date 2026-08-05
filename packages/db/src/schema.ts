// The combined schema barrel: what `getDb` registers and drizzle-kit reads.
//
// - ./auth-schema.ts  CLI-generated (user/session/account/verification).
//   Never edit; regenerate with `pnpm --filter @roster/api run auth:schema`.
// - ./app-schema.ts   hand-owned app tables (classes, …).
//
// Sibling files mean an auth-schema regeneration can never wipe an app table.

export * from "./app-schema";
export * from "./auth-schema";
