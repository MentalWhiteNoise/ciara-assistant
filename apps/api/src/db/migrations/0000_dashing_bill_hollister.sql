CREATE TABLE `refresh_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`password_hash` text NOT NULL,
	`display_name` text DEFAULT 'Owner' NOT NULL,
	`settings` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`parent_id` text,
	`tax_line` text,
	`color` text,
	`icon` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_unique` ON `categories` (`name`);--> statement-breakpoint
CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`connector` text,
	`is_active` integer DEFAULT true NOT NULL,
	`metadata` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`subtitle` text,
	`isbn` text,
	`sku` text,
	`description` text,
	`cover_image` text,
	`published_at` text,
	`status` text DEFAULT 'active' NOT NULL,
	`metadata` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text,
	`product_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`start_date` text,
	`target_date` text,
	`completed_date` text,
	`budget` real,
	`color` text,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `calendar_events` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`event_type_id` text,
	`project_id` text,
	`product_id` text,
	`start_at` text NOT NULL,
	`end_at` text,
	`all_day` integer DEFAULT false NOT NULL,
	`location` text,
	`description` text,
	`metadata` text,
	`external_id` text,
	`external_cal` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`event_type_id`) REFERENCES `event_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `event_types` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`icon` text,
	`category` text,
	`metadata_schema` text,
	`default_tasks` text,
	`default_duration_hours` real,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_types_name_unique` ON `event_types` (`name`);--> statement-breakpoint
CREATE TABLE `task_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`event_type_id` text,
	`tasks` text NOT NULL,
	`description` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`event_type_id`) REFERENCES `event_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'todo' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`due_date` text,
	`due_time` text,
	`scheduled_date` text,
	`event_id` text,
	`project_id` text,
	`parent_task_id` text,
	`template_id` text,
	`recurrence` text,
	`completed_at` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`tags` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `calendar_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `task_templates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text,
	`file_path` text NOT NULL,
	`file_type` text,
	`original_name` text,
	`mime_type` text,
	`size_bytes` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`amount` real NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`description` text NOT NULL,
	`category_id` text,
	`channel_id` text,
	`product_id` text,
	`event_id` text,
	`project_id` text,
	`payee` text,
	`payment_method` text,
	`reference_id` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`notes` text,
	`is_tax_deductible` integer DEFAULT false NOT NULL,
	`tax_category` text,
	`occurred_at` text NOT NULL,
	`imported_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `inventory_items` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`location` text DEFAULT 'home' NOT NULL,
	`on_hand` integer DEFAULT 0 NOT NULL,
	`reserved` integer DEFAULT 0 NOT NULL,
	`in_transit` integer DEFAULT 0 NOT NULL,
	`reorder_point` integer,
	`cost_per_unit` real,
	`notes` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `inventory_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`movement_type` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_cost` real,
	`source_id` text,
	`source_type` text,
	`notes` text,
	`occurred_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`purchase_date` text NOT NULL,
	`purchase_price` real NOT NULL,
	`transaction_id` text,
	`useful_life_years` integer,
	`depreciation_method` text DEFAULT 'straight_line',
	`notes` text,
	`status` text DEFAULT 'active' NOT NULL,
	`disposed_at` text,
	`disposal_value` real,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `mileage_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`purpose` text NOT NULL,
	`origin` text,
	`destination` text,
	`miles` real NOT NULL,
	`rate` real,
	`event_id` text,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `calendar_events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `import_dedup_log` (
	`connector` text NOT NULL,
	`external_id` text NOT NULL,
	`imported_at` text DEFAULT (datetime('now')) NOT NULL,
	`transaction_id` text,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sync_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`connector` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`started_at` text,
	`completed_at` text,
	`records_imported` integer DEFAULT 0 NOT NULL,
	`records_skipped` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`config` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
