PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`reviewer_id` text,
	`reviewer_name` text NOT NULL,
	`rating` integer NOT NULL,
	`comment` text,
	`image_urls` text DEFAULT '[]',
	`is_ae` integer DEFAULT false NOT NULL,
	`source_review_id` text,
	`review_date` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "reviews_rating_check" CHECK("__new_reviews"."rating" >= 1 and "__new_reviews"."rating" <= 5)
);
--> statement-breakpoint
INSERT INTO `__new_reviews`("id", "product_id", "reviewer_id", "reviewer_name", "rating", "comment", "image_urls", "is_ae", "source_review_id", "review_date", "created_at") SELECT "id", "product_id", "reviewer_id", "reviewer_name", "rating", "comment", "image_urls", "is_ae", "source_review_id", "review_date", "created_at" FROM `reviews`;--> statement-breakpoint
DROP TABLE `reviews`;--> statement-breakpoint
ALTER TABLE `__new_reviews` RENAME TO `reviews`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `reviews_product_id_review_date_idx` ON `reviews` (`product_id`,`review_date`);--> statement-breakpoint
CREATE INDEX `reviews_product_id_is_ae_idx` ON `reviews` (`product_id`,`is_ae`);--> statement-breakpoint
ALTER TABLE `products` ADD `review_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `average_review` real;