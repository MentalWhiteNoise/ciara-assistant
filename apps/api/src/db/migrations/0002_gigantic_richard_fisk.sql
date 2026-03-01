CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`product_id` text,
	`title` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`unit_price` real DEFAULT 0 NOT NULL,
	`variant` text,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`order_number` text NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`external_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`customer_name` text NOT NULL,
	`customer_email` text,
	`ship_to_line1` text,
	`ship_to_line2` text,
	`ship_to_city` text,
	`ship_to_state` text,
	`ship_to_zip` text,
	`ship_to_country` text,
	`tracking_number` text,
	`carrier` text,
	`subtotal` real DEFAULT 0 NOT NULL,
	`shipping_cost` real DEFAULT 0 NOT NULL,
	`tax_amount` real DEFAULT 0 NOT NULL,
	`total` real DEFAULT 0 NOT NULL,
	`customer_note` text,
	`internal_note` text,
	`ordered_at` text NOT NULL,
	`due_date` text,
	`shipped_at` text,
	`delivered_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `tasks` ADD `order_id` text REFERENCES orders(id);