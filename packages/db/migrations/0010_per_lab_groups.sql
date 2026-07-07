DROP TABLE `student_lab_repos`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`lab_id` text NOT NULL,
	`gh_team_id` integer NOT NULL,
	`gh_team_slug` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`gh_repo_id` integer,
	`gh_repo_full_name` text,
	`creator_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`lab_id`) REFERENCES `labs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`creator_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
-- Per-lab reshape (spec 2026-07-07): groups are WIPED and re-formed, so the
-- old rows are not copied (they lack lab_id/slug — new columns, not renames).
-- Dropping the old table discards them; the new groups table starts empty.
DROP TABLE `groups`;--> statement-breakpoint
ALTER TABLE `__new_groups` RENAME TO `groups`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `groups_gh_team_id_unique` ON `groups` (`gh_team_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `groups_gh_repo_id_unique` ON `groups` (`gh_repo_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `groups_lab_id_name_unique` ON `groups` (`lab_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `groups_lab_id_slug_unique` ON `groups` (`lab_id`,`slug`);