CREATE TABLE `wishlist_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`icon` text DEFAULT 'Heart' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`total_products` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `wishlist_folders_user_id_idx` ON `wishlist_folders` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `wishlist_folders_user_name_uidx` ON `wishlist_folders` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `wishlist_products` (
	`id` text PRIMARY KEY NOT NULL,
	`folder_id` text NOT NULL,
	`product_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`folder_id`) REFERENCES `wishlist_folders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wishlist_products_folder_product_uidx` ON `wishlist_products` (`folder_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `wishlist_products_product_id_idx` ON `wishlist_products` (`product_id`);--> statement-breakpoint
CREATE INDEX `wishlist_products_folder_id_created_at_idx` ON `wishlist_products` (`folder_id`,`created_at`);