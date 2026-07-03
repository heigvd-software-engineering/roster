-- join_token is enforced NOT NULL at the app level (Drizzle schema); the
-- column stays nullable in SQLite because ADD COLUMN can't add NOT NULL
-- without a constant default, and existing rows are backfilled below.
ALTER TABLE `classes` ADD `join_token` text;--> statement-breakpoint
UPDATE `classes` SET `join_token` = lower(hex(randomblob(16)));--> statement-breakpoint
CREATE UNIQUE INDEX `classes_join_token_unique` ON `classes` (`join_token`);