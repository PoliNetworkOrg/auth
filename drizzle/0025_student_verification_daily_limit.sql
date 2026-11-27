CREATE TABLE "student_verification_send" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "student_verification_send" ADD CONSTRAINT "student_verification_send_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "studentVerificationSend_userId_sentAt_idx" ON "student_verification_send" USING btree ("user_id","sent_at");