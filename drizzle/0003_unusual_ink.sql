CREATE TABLE `listing_enrichment` (
	`listing_id` text PRIMARY KEY NOT NULL,
	`model` text NOT NULL,
	`schema_version` integer NOT NULL,
	`content_hash_at_enrichment` text NOT NULL,
	`enriched_at` text NOT NULL,
	`summary` text,
	`ai_risk_level` text,
	`data` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`error` text,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE no action
);
