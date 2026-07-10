CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`reviewer_id` text NOT NULL,
	`reviewer_name` text NOT NULL,
	`rating` integer NOT NULL,
	`comment` text,
	`image_urls` text DEFAULT '[]',
	`created_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "reviews_rating_check" CHECK("reviews"."rating" >= 1 and "reviews"."rating" <= 5)
);
