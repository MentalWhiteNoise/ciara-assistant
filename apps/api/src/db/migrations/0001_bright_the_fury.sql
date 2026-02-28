PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_import_dedup_log` (
	`connector` text NOT NULL,
	`external_id` text NOT NULL,
	`imported_at` text DEFAULT (datetime('now')) NOT NULL,
	`transaction_id` text,
	PRIMARY KEY(`connector`, `external_id`),
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_import_dedup_log`("connector", "external_id", "imported_at", "transaction_id") SELECT "connector", "external_id", "imported_at", "transaction_id" FROM `import_dedup_log`;--> statement-breakpoint
DROP TABLE `import_dedup_log`;--> statement-breakpoint
ALTER TABLE `__new_import_dedup_log` RENAME TO `import_dedup_log`;--> statement-breakpoint
PRAGMA foreign_keys=ON;