-- Lab -> Assignment. Vocabulary only: no column gains, loses or changes meaning.
--
-- Hand-written, because drizzle-kit cannot tell a rename from a drop-and-create
-- without an interactive answer, and its non-interactive guess is DROP + CREATE,
-- which would take every row with it. `meta/0017_snapshot.json` is the matching
-- hand-built snapshot; `db:generate` reports no diff against it.
--
-- SQLite rewrites the child FK clause in `groups` on RENAME TO, and rewrites an
-- index's column references on RENAME COLUMN, but it never renames the index
-- OBJECT. So the three indexes carrying the old word are dropped and recreated;
-- that is the only reason this migration is more than two statements.
--
-- `groups.slug` is untouched, so every GitHub team and work repo keeps its name.
ALTER TABLE `labs` RENAME TO `assignments`;--> statement-breakpoint
ALTER TABLE `groups` RENAME COLUMN `lab_id` TO `assignment_id`;--> statement-breakpoint
DROP INDEX `labs_class_id_title_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `assignments_class_id_title_unique` ON `assignments` (`class_id`,`title`);--> statement-breakpoint
DROP INDEX `groups_lab_id_name_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `groups_assignment_id_name_unique` ON `groups` (`assignment_id`,`name`);--> statement-breakpoint
DROP INDEX `groups_lab_id_slug_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `groups_assignment_id_slug_unique` ON `groups` (`assignment_id`,`slug`);
