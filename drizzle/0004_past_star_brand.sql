CREATE TABLE `listing_vision` (
	`listing_id` text PRIMARY KEY NOT NULL,
	`model` text NOT NULL,
	`schema_version` integer NOT NULL,
	`photo_hash_at_vision` text,
	`image_count` integer DEFAULT 0 NOT NULL,
	`analyzed_at` text NOT NULL,
	`visual_summary` text,
	`features` text,
	`search_text` text,
	`data` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`error` text,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE no action
);
