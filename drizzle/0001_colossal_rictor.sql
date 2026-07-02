CREATE TABLE `price_history` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`source_run_id` text,
	`observed_at` text NOT NULL,
	`price_raw` text,
	`price_monthly` real,
	`price_effective_monthly` real,
	`concessions_raw` text,
	`deposit_raw` text,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `price_history_listing_idx` ON `price_history` (`listing_id`,`observed_at`);--> statement-breakpoint
ALTER TABLE `duplicate_groups` ADD `primary_listing_id` text;--> statement-breakpoint
ALTER TABLE `duplicate_groups` ADD `confidence` text DEFAULT 'low' NOT NULL;--> statement-breakpoint
ALTER TABLE `duplicate_groups` ADD `listing_ids` text;--> statement-breakpoint
ALTER TABLE `listings` ADD `canonical_url` text;--> statement-breakpoint
ALTER TABLE `sources` ADD `registry_status` text DEFAULT 'disabled_needs_review' NOT NULL;--> statement-breakpoint
ALTER TABLE `sources` ADD `last_verification_status` text;--> statement-breakpoint
ALTER TABLE `sources` ADD `last_verification_at` text;--> statement-breakpoint
ALTER TABLE `sources` ADD `last_verification_summary` text;