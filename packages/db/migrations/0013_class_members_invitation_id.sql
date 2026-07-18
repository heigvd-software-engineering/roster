PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_class_members` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`github_id` text,
	`invitation_id` text,
	`state` text NOT NULL,
	`login` text,
	`avatar_url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
-- HAND-EDITED (AGENTS.md rule 9). drizzle-kit emitted
-- `SELECT "invitation_id" FROM class_members` — a column the OLD table does not
-- have, because it cannot know this rebuild also introduces one. The two CASEs
-- are the BACKFILL: `github_id` used to hold an INVITATION id on `pending` rows
-- and a USER id on every other row, so the split routes each to its own column.
-- Pending rows end with a NULL user id because they never had one — the
-- invitations API returns login and email, never the invitee's id.
INSERT INTO `__new_class_members`("id", "class_id", "github_id", "invitation_id", "state", "login", "avatar_url", "created_at", "updated_at") SELECT "id", "class_id", CASE WHEN "state" = 'pending' THEN NULL ELSE "github_id" END, CASE WHEN "state" = 'pending' THEN "github_id" ELSE NULL END, "state", "login", "avatar_url", "created_at", "updated_at" FROM `class_members`;--> statement-breakpoint
DROP TABLE `class_members`;--> statement-breakpoint
ALTER TABLE `__new_class_members` RENAME TO `class_members`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `class_members_class_id_github_id_unique` ON `class_members` (`class_id`,`github_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `class_members_class_id_invitation_id_unique` ON `class_members` (`class_id`,`invitation_id`);