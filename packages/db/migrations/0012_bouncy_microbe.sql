ALTER TABLE `product_skus` ADD `est_profit` integer;--> statement-breakpoint
ALTER TABLE `products` ADD `revenue_in_profit` integer DEFAULT 0 NOT NULL;