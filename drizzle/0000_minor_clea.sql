CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`vehicleId` text NOT NULL,
	`registration` text NOT NULL,
	`action` text NOT NULL,
	`detail` text NOT NULL,
	`actor` text NOT NULL,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vehicles` (
	`id` text PRIMARY KEY NOT NULL,
	`registration` text NOT NULL,
	`asset` text NOT NULL,
	`category` text NOT NULL,
	`model` text NOT NULL,
	`site` text NOT NULL,
	`responsible` text NOT NULL,
	`roadworthy` text NOT NULL,
	`roadworthyNumber` text NOT NULL,
	`insurance` text NOT NULL,
	`policyNumber` text NOT NULL,
	`insurer` text NOT NULL,
	`notes` text NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_vehicles_registration` ON `vehicles` (`registration`);