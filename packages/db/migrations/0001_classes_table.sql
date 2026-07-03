CREATE TABLE `classes` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` integer NOT NULL,
	`installation_id` integer NOT NULL,
	`connected_by_user_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`connected_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `classes_org_id_unique` ON `classes` (`org_id`);