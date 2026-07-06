CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`gh_team_id` integer NOT NULL,
	`gh_team_slug` text NOT NULL,
	`name` text NOT NULL,
	`creator_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`creator_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_gh_team_id_unique` ON `groups` (`gh_team_id`);