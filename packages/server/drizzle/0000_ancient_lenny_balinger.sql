CREATE TABLE `latency_results` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`tested_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`method` text NOT NULL,
	`delay_ms` integer,
	`status` text NOT NULL,
	`error` text,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `latency_node_time_idx` ON `latency_results` (`node_id`,`tested_at`);--> statement-breakpoint
CREATE TABLE `node_tags` (
	`node_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`node_id`, `tag_id`),
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `node_tags_tag_idx` ON `node_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`raw_name` text,
	`type` text NOT NULL,
	`server` text NOT NULL,
	`port` integer NOT NULL,
	`config` text NOT NULL,
	`fingerprint` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`remark` text,
	`last_delay_ms` integer,
	`last_status` text,
	`last_tested_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nodes_fingerprint_idx` ON `nodes` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `nodes_type_idx` ON `nodes` (`type`);--> statement-breakpoint
CREATE INDEX `nodes_last_delay_idx` ON `nodes` (`last_delay_ms`);--> statement-breakpoint
CREATE TABLE `rule_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`definition` text NOT NULL,
	`builtin` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rulesets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`kind` text NOT NULL,
	`behavior` text NOT NULL,
	`format` text NOT NULL,
	`url` text,
	`content` text,
	`builtin` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token` text NOT NULL,
	`format` text DEFAULT 'auto' NOT NULL,
	`profile_id` text,
	`selection` text NOT NULL,
	`options` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`expires_at` integer,
	`hit_count` integer DEFAULT 0 NOT NULL,
	`last_access_at` integer,
	`last_access_ua` text,
	`last_access_ip` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `rule_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_token_idx` ON `subscriptions` (`token`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#64748b' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_idx` ON `tags` (`name`);