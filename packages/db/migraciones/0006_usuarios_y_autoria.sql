CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "content_plans" ADD COLUMN "approved_by" uuid;
--> statement-breakpoint
ALTER TABLE "content_plans" ADD COLUMN "reopened_by" uuid;
--> statement-breakpoint
ALTER TABLE "brand_profiles" ADD COLUMN "created_by" uuid;
--> statement-breakpoint
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_reopened_by_users_id_fk" FOREIGN KEY ("reopened_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "brand_profiles" ADD CONSTRAINT "brand_profiles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
