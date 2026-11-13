CREATE TABLE `kdp_daily_kenp` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`title` text NOT NULL,
	`asin` text,
	`marketplace` text NOT NULL,
	`pages_read` real,
	`pages_listened` real,
	`total_pages` real,
	`import_id` text,
	FOREIGN KEY (`import_id`) REFERENCES `kdp_imports`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `kdp_daily_kenp_date` ON `kdp_daily_kenp` (`date`);--> statement-breakpoint
CREATE TABLE `kdp_daily_sales` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`format` text NOT NULL,
	`title` text NOT NULL,
	`asin` text,
	`marketplace` text NOT NULL,
	`royalty_type` text,
	`transaction_type` text,
	`units_sold` real,
	`units_refunded` real,
	`net_units` real,
	`avg_list_price` real,
	`avg_offer_price` real,
	`delivery_cost` real,
	`royalty` real,
	`currency` text,
	`import_id` text,
	FOREIGN KEY (`import_id`) REFERENCES `kdp_imports`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `kdp_daily_sales_date` ON `kdp_daily_sales` (`date`);--> statement-breakpoint
CREATE TABLE `kdp_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`report_type` text NOT NULL,
	`original_name` text NOT NULL,
	`stored_name` text NOT NULL,
	`file_hash` text NOT NULL,
	`coverage` text,
	`rows_imported` integer DEFAULT 0 NOT NULL,
	`transactions_created` integer DEFAULT 0 NOT NULL,
	`warnings` text,
	`imported_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `kdp_payment_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`source` text NOT NULL,
	`currency` text NOT NULL,
	`accrued_royalty` real,
	`tax_withholding` real,
	`net_earnings` real,
	FOREIGN KEY (`payment_id`) REFERENCES `kdp_payments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `kdp_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`sales_period` text NOT NULL,
	`marketplace` text NOT NULL,
	`payment_number` text NOT NULL,
	`payment_date` text,
	`payment_method` text,
	`currency` text NOT NULL,
	`accrued_royalty` real,
	`tax_withholding` real,
	`net_earnings` real,
	`fx_rate` real,
	`payout_currency` text,
	`payout_amount` real,
	`status` text NOT NULL,
	`transaction_id` text,
	`import_id` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`import_id`) REFERENCES `kdp_imports`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kdp_payments_key` ON `kdp_payments` (`sales_period`,`marketplace`,`payment_number`);--> statement-breakpoint
CREATE TABLE `kdp_statement_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`period` text NOT NULL,
	`format` text NOT NULL,
	`title` text NOT NULL,
	`asin` text,
	`marketplace` text NOT NULL,
	`units_sold` real,
	`units_refunded` real,
	`net_units` real,
	`royalty_type` text,
	`transaction_type` text,
	`currency` text,
	`avg_list_price` real,
	`avg_offer_price` real,
	`delivery_cost` real,
	`earnings` real,
	`import_id` text,
	FOREIGN KEY (`import_id`) REFERENCES `kdp_imports`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `kdp_statement_period` ON `kdp_statement_lines` (`period`);--> statement-breakpoint
CREATE TABLE `reminder_keys` (
	`key` text PRIMARY KEY NOT NULL,
	`checklist_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
