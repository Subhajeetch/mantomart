CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`status` text DEFAULT 'success' NOT NULL,
	`severity` text DEFAULT 'info' NOT NULL,
	`actor_id` text,
	`actor_name` text,
	`actor_email` text,
	`actor_role` text,
	`target_type` text,
	`target_id` text,
	`target_label` text,
	`changes` text,
	`metadata` text,
	`ip_address` text,
	`user_agent` text,
	`request_method` text,
	`request_path` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_logs_created_at_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_actor_id_idx` ON `audit_logs` (`actor_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_action_idx` ON `audit_logs` (`action`);--> statement-breakpoint
CREATE INDEX `audit_logs_category_idx` ON `audit_logs` (`category`);--> statement-breakpoint
CREATE INDEX `audit_logs_target_idx` ON `audit_logs` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_severity_idx` ON `audit_logs` (`severity`);--> statement-breakpoint
CREATE INDEX `audit_logs_status_idx` ON `audit_logs` (`status`);