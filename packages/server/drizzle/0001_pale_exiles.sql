ALTER TABLE `rulesets` ADD `cached_at` integer;--> statement-breakpoint
ALTER TABLE `rulesets` ADD `cache_size` integer;--> statement-breakpoint
ALTER TABLE `rulesets` ADD `cache_etag` text;--> statement-breakpoint
ALTER TABLE `rulesets` ADD `cache_error` text;