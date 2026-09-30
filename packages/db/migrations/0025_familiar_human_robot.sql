CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`checkout_session_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'ordered' NOT NULL,
	`payment_status` text DEFAULT 'paid' NOT NULL,
	`payment_method` text NOT NULL,
	`payment_provider_order_id` text NOT NULL,
	`payment_transaction_id` text,
	`currency` text DEFAULT 'USD' NOT NULL,
	`subtotal_cents` integer NOT NULL,
	`shipping_total_cents` integer DEFAULT 0 NOT NULL,
	`total_cents` integer NOT NULL,
	`customer_name` text NOT NULL,
	`customer_email` text NOT NULL,
	`customer_phone` text NOT NULL,
	`address_snapshot` text NOT NULL,
	`items_snapshot` text NOT NULL,
	`shipping_snapshot` text NOT NULL,
	`is_fulfilled` integer DEFAULT false NOT NULL,
	`fulfilled_at` integer,
	`ae_order_id` text,
	`ae_raw_res` text,
	`cancel_reason` text,
	`cancelled_at` integer,
	`last_address_changed_at` integer,
	`address_change_history` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`checkout_session_id`) REFERENCES `checkout_sessions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_checkout_session_uidx` ON `orders` (`checkout_session_id`);--> statement-breakpoint
CREATE INDEX `orders_user_id_created_at_idx` ON `orders` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `orders_status_created_at_idx` ON `orders` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `orders_is_fulfilled_idx` ON `orders` (`is_fulfilled`);--> statement-breakpoint
CREATE INDEX `orders_ae_order_id_idx` ON `orders` (`ae_order_id`);--> statement-breakpoint
ALTER TABLE `checkout_sessions` ADD `address_id` text;--> statement-breakpoint
ALTER TABLE `checkout_sessions` ADD `address_snapshot` text DEFAULT 'null';--> statement-breakpoint
ALTER TABLE `checkout_sessions` ADD `shipping_selection` text DEFAULT 'null';--> statement-breakpoint
ALTER TABLE `checkout_sessions` ADD `shipping_total` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `checkout_sessions` ADD `paypal_order_id` text;