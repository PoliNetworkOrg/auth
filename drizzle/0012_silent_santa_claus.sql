CREATE TABLE "access_snapshot_state" (
	"projection" text PRIMARY KEY NOT NULL,
	"generation" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"body" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entra_group_observation" (
	"source" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"members" text[] NOT NULL,
	"observed_at" timestamp with time zone NOT NULL
);
