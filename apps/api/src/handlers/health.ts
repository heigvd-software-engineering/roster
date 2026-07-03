import { factory } from "../factory";

/** Liveness probe. */
export const health = factory.createHandlers((c) =>
  c.json({ ok: true } as const),
);
