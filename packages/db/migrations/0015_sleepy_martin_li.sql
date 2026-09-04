CREATE INDEX `product_attributes_product_id_idx` ON `product_attributes` (`product_id`);--> statement-breakpoint
CREATE INDEX `product_attributes_product_id_position_idx` ON `product_attributes` (`product_id`,`position`,`attr_name`);--> statement-breakpoint
CREATE INDEX `product_skus_product_id_idx` ON `product_skus` (`product_id`);--> statement-breakpoint
CREATE INDEX `product_skus_product_id_price_id_idx` ON `product_skus` (`product_id`,`price`,`id`);--> statement-breakpoint
CREATE INDEX `products_category_id_idx` ON `products` (`category_id`);--> statement-breakpoint
CREATE INDEX `products_product_added_by_idx` ON `products` (`product_added_by`);--> statement-breakpoint
CREATE INDEX `products_published_position_id_idx` ON `products` (`published`,`position`,`id`);--> statement-breakpoint
CREATE INDEX `products_published_featured_position_id_idx` ON `products` (`published`,`featured`,`position`,`id`);--> statement-breakpoint
CREATE INDEX `sku_properties_sku_id_idx` ON `sku_properties` (`sku_id`);