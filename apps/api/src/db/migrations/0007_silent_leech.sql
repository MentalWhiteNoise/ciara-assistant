CREATE TABLE `payee_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`connector` text NOT NULL,
	`counterparty_id` text NOT NULL,
	`counterparty_name` text,
	`action` text NOT NULL,
	`category_id` text,
	`channel_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payee_rules_connector_party_idx` ON `payee_rules` (`connector`,`counterparty_id`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `review_status` text DEFAULT 'confirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `related_transaction_id` text REFERENCES transactions(id);--> statement-breakpoint
ALTER TABLE `transactions` ADD `counterparty_id` text;