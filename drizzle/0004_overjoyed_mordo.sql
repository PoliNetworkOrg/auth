CREATE TABLE "permission" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permission_implication" (
	"permission_id" text NOT NULL,
	"implied_permission_id" text NOT NULL,
	CONSTRAINT "permission_implication_permission_id_implied_permission_id_pk" PRIMARY KEY("permission_id","implied_permission_id")
);
--> statement-breakpoint
CREATE TABLE "role" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"managed" boolean DEFAULT false NOT NULL,
	"source_state" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_parent" (
	"role_id" text NOT NULL,
	"parent_role_id" text NOT NULL,
	CONSTRAINT "role_parent_role_id_parent_role_id_pk" PRIMARY KEY("role_id","parent_role_id")
);
--> statement-breakpoint
CREATE TABLE "role_permission" (
	"role_id" text NOT NULL,
	"permission_id" text NOT NULL,
	CONSTRAINT "role_permission_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "user_role" (
	"user_id" text NOT NULL,
	"role_id" text NOT NULL,
	"assigned_by" text,
	"assignedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_role_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
ALTER TABLE "identity_evidence" ADD COLUMN "states" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "permission_implication" ADD CONSTRAINT "permission_implication_permission_id_permission_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_implication" ADD CONSTRAINT "permission_implication_implied_permission_id_permission_id_fk" FOREIGN KEY ("implied_permission_id") REFERENCES "public"."permission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_parent" ADD CONSTRAINT "role_parent_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_parent" ADD CONSTRAINT "role_parent_parent_role_id_role_id_fk" FOREIGN KEY ("parent_role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_id_permission_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "permission_key_uidx" ON "permission" USING btree ("key");--> statement-breakpoint
CREATE INDEX "permissionImplication_implied_idx" ON "permission_implication" USING btree ("implied_permission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_key_uidx" ON "role" USING btree ("key");--> statement-breakpoint
CREATE INDEX "roleParent_parent_idx" ON "role_parent" USING btree ("parent_role_id");--> statement-breakpoint
CREATE INDEX "rolePermission_permission_idx" ON "role_permission" USING btree ("permission_id");--> statement-breakpoint
CREATE INDEX "userRole_role_idx" ON "user_role" USING btree ("role_id");--> statement-breakpoint
-- Carry the single state each account proved into the new list before 0005 drops it.
UPDATE "identity_evidence" SET "states" = ARRAY["state"] WHERE "state" IS NOT NULL;--> statement-breakpoint
-- The roles the identity provider defines itself. Membership follows identity evidence:
-- the application never writes user_role rows for these. Names, descriptions, permissions,
-- and hierarchy are administrator-editable from here on, so this seed never runs again.
INSERT INTO "role" ("id", "key", "name", "description", "managed", "source_state") VALUES
	('static-role-socio', 'socio', 'Socio', 'Member of PoliNetwork APS.', true, 'socio'),
	('static-role-direttivo', 'direttivo', 'Direttivo', 'Member of the PoliNetwork APS board.', true, 'direttivo'),
	('static-role-student', 'student', 'Student', 'Verified Politecnico di Milano student.', true, 'student')
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
-- The two permissions this service already put in tokens, so existing consumers keep working.
INSERT INTO "permission" ("id", "key", "name", "description") VALUES
	('seed-permission-membership-read', 'membership:read', 'Read membership', 'See that someone is a member of PoliNetwork APS.'),
	('seed-permission-student-verified', 'student:verified', 'Verified student', 'See that someone verified a Politecnico di Milano student email.')
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permission" ("role_id", "permission_id") VALUES
	('static-role-socio', 'seed-permission-membership-read'),
	('static-role-student', 'seed-permission-student-verified')
ON CONFLICT DO NOTHING;
