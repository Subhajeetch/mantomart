ALTER TABLE `header_collections` RENAME TO `header_menu_nodes`;--> statement-breakpoint
DROP TABLE `header_collection_items`;--> statement-breakpoint
DROP INDEX `header_collections_slug_unique`;--> statement-breakpoint
DROP INDEX `header_collections_position_idx`;--> statement-breakpoint
DROP INDEX `header_collections_visible_idx`;--> statement-breakpoint
ALTER TABLE `header_menu_nodes` ADD `parent_id` text REFERENCES header_menu_nodes(id);--> statement-breakpoint
ALTER TABLE `header_menu_nodes` ADD `category_id` text REFERENCES categories(id);--> statement-breakpoint
ALTER TABLE `header_menu_nodes` ADD `custom_url` text;--> statement-breakpoint
ALTER TABLE `header_menu_nodes` ADD `title` text;--> statement-breakpoint
ALTER TABLE `header_menu_nodes` ADD `layout` text DEFAULT 'mega' NOT NULL;--> statement-breakpoint
ALTER TABLE `header_menu_nodes` ADD `featured` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `header_menu_parent_idx` ON `header_menu_nodes` (`parent_id`);--> statement-breakpoint
CREATE INDEX `header_menu_category_idx` ON `header_menu_nodes` (`category_id`);--> statement-breakpoint
CREATE INDEX `header_menu_position_idx` ON `header_menu_nodes` (`position`);--> statement-breakpoint
CREATE INDEX `header_menu_visible_idx` ON `header_menu_nodes` (`is_visible`);--> statement-breakpoint
ALTER TABLE `header_menu_nodes` DROP COLUMN `name`;--> statement-breakpoint
ALTER TABLE `header_menu_nodes` DROP COLUMN `slug`;