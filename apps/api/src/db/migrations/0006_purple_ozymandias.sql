ALTER TABLE `kdp_daily_sales` ADD `order_date` text;--> statement-breakpoint
CREATE INDEX `kdp_daily_sales_order_date` ON `kdp_daily_sales` (`order_date`);--> statement-breakpoint
ALTER TABLE `kdp_imports` ADD `parser_version` integer DEFAULT 1 NOT NULL;