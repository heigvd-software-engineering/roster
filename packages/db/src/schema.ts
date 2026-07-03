// The combined schema barrel — what `getDb` registers and drizzle-kit reads.
//
// - ./auth-schema.ts  CLI-GENERATED (user/session/account/verification).
//   Never edit; regenerate via `pnpm --filter @labs/api run auth:schema`.
// - ./app-schema.ts   HAND-OWNED app tables (classes, …).
//
// Keeping them in sibling files means an auth-schema regeneration can never
// wipe an app table.

export * from "./app-schema";
export * from "./auth-schema";
