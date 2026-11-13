CREATE TABLE `import_raw_records` (
	`id` text PRIMARY KEY NOT NULL,
	`connector` text NOT NULL,
	`external_id` text NOT NULL,
	`occurred_at` text,
	`payload` text NOT NULL,
	`sync_job_id` text,
	`fetched_at` text NOT NULL,
	`normalized_at` text,
	FOREIGN KEY (`sync_job_id`) REFERENCES `sync_jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_raw_records_connector_external_idx` ON `import_raw_records` (`connector`,`external_id`);--> statement-breakpoint
CREATE INDEX `import_raw_records_occurred_idx` ON `import_raw_records` (`connector`,`occurred_at`);