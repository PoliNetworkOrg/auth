CREATE TABLE "student_verification_challenge" (
	"user_id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_sent_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "student_verification_challenge" ADD CONSTRAINT "student_verification_challenge_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "studentVerificationChallenge_email_uidx" ON "student_verification_challenge" USING btree ("email");--> statement-breakpoint
CREATE INDEX "studentVerificationChallenge_expiresAt_idx" ON "student_verification_challenge" USING btree ("expires_at");
