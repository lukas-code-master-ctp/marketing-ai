CREATE TABLE "content_pieces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan_slot_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"data" jsonb NOT NULL,
	"brand_profile_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_pieces_plan_slot_id_unique" UNIQUE("plan_slot_id"),
	CONSTRAINT "content_pieces_channel_check" CHECK (channel in ('instagram', 'linkedin', 'facebook', 'tiktok', 'blog'))
);
--> statement-breakpoint
ALTER TABLE "content_pieces" ADD CONSTRAINT "content_pieces_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "content_pieces" ADD CONSTRAINT "content_pieces_slot_org_fk" FOREIGN KEY ("plan_slot_id","organization_id") REFERENCES "public"."plan_slots"("id","organization_id") ON DELETE cascade ON UPDATE no action;
