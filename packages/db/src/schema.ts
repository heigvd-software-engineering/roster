// Combined DB schema (the barrel). This file is hand-owned and safe to edit.
//
// - Auth tables (user/session/account/verification) are CLI-GENERATED in
//   ./auth-schema.ts — never edit that file; regenerate it via
//   `pnpm --filter @labs/api run auth:schema`.
// - App-domain tables (classes, labs, groups, student_lab_repos, …) are added
//   per feature in their own sibling files (e.g. ./app-schema.ts) and
//   re-exported here, so regenerating the auth schema never touches them.

export * from "./auth-schema";
