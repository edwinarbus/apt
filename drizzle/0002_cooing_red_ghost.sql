CREATE TABLE `digest_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`saved_searches_evaluated` integer DEFAULT 0 NOT NULL,
	`listings_evaluated` integer DEFAULT 0 NOT NULL,
	`new_matches` integer DEFAULT 0 NOT NULL,
	`price_drop_matches` integer DEFAULT 0 NOT NULL,
	`dropped_matches` integer DEFAULT 0 NOT NULL,
	`dry_run` integer DEFAULT false NOT NULL,
	`report_path` text
);
--> statement-breakpoint
CREATE TABLE `saved_search_matches` (
	`id` text PRIMARY KEY NOT NULL,
	`saved_search_id` text NOT NULL,
	`listing_id` text NOT NULL,
	`first_matched_at` text NOT NULL,
	`last_matched_at` text NOT NULL,
	`notified_at` text,
	`notified_price_monthly` real,
	`still_matching` integer DEFAULT true NOT NULL,
	`distance_km` real,
	`unknowns` text,
	FOREIGN KEY (`saved_search_id`) REFERENCES `saved_searches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `saved_search_matches_unique` ON `saved_search_matches` (`saved_search_id`,`listing_id`);--> statement-breakpoint
CREATE INDEX `saved_search_matches_search_idx` ON `saved_search_matches` (`saved_search_id`,`still_matching`);