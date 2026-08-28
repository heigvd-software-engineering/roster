-- Better Auth 1.7 scopes account identity by (issuer, accountId) and refuses to
-- query the table without `issuer`. Drizzle generated `ALTER TABLE account ADD
-- issuer text NOT NULL`, which SQLite rejects on a populated table, and no CLI
-- picks the values — the 1.7 upgrade guide says the issuer choice is ours. So
-- the table is rebuilt with the backfill computed inside the copy: one pass, no
-- interval where the column exists but is empty.
--
-- PROVENANCE. Column and index from `pnpm --filter @roster/api auth:schema`
-- (auth@1.7.2, which emits `issuer` and the unique index; the abandoned
-- @better-auth/cli@1.4.21 does not, and regenerating with it drops them). The
-- rebuild and the CASE below are hand-written, because no tool chooses issuer
-- values. They follow the table in "Account identity is scoped by issuer":
--   https://better-auth.com/docs/guides/1-7-upgrade-guide
-- which gives `local:oauth:<providerId>` for an OAuth provider with no issuer
-- of its own, the provider's real issuer where it has one, and
-- `local:credential` for password accounts. The switch value is confirmed
-- against the stored id_token, whose `iss` claim is "https://login.eduid.ch/".
-- Rehearsed on a local copy of demo's rows before running anywhere real.
--
-- The values are what Better Auth computes at runtime, not conventions we
-- invented: `local:oauth:<providerId>` for an OAuth provider with no issuer of
-- its own (github), and the provider's real issuer where it has one — for
-- `switch` that is `accountIssuer` in lib/auth/config.ts, and the trailing
-- slash is SWITCH's own: the stored id_token carries
-- "iss":"https://login.eduid.ch/". The CASE ends in a catch-all so no row can
-- come out NULL whatever provider ids the table holds; `credential` is named
-- explicitly because the guide gives it a different namespace, even though
-- roster has no password accounts (edu-ID is the only sign-in).
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_account` (
	`id` text PRIMARY KEY NOT NULL,
	`issuer` text NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_account`(
	`id`, `issuer`, `account_id`, `provider_id`, `user_id`, `access_token`,
	`refresh_token`, `id_token`, `access_token_expires_at`,
	`refresh_token_expires_at`, `scope`, `password`, `created_at`, `updated_at`
)
SELECT
	`id`,
	CASE `provider_id`
		WHEN 'switch' THEN 'https://login.eduid.ch/'
		WHEN 'credential' THEN 'local:credential'
		ELSE 'local:oauth:' || `provider_id`
	END,
	`account_id`, `provider_id`, `user_id`, `access_token`, `refresh_token`,
	`id_token`, `access_token_expires_at`, `refresh_token_expires_at`, `scope`,
	`password`, `created_at`, `updated_at`
FROM `account`;--> statement-breakpoint
DROP TABLE `account`;--> statement-breakpoint
ALTER TABLE `__new_account` RENAME TO `account`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_issuer_accountId_uidx` ON `account` (`issuer`,`account_id`);
