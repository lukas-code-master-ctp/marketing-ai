CREATE TABLE "strategy_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"period" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "strategy_briefs_brand_id_period_unique" UNIQUE("brand_id","period")
);
--> statement-breakpoint
ALTER TABLE "strategy_briefs" ADD CONSTRAINT "strategy_briefs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "strategy_briefs" ADD CONSTRAINT "strategy_briefs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "strategy_briefs" ADD CONSTRAINT "strategy_briefs_brand_org_fk" FOREIGN KEY ("brand_id","organization_id") REFERENCES "public"."brands"("id","organization_id") ON DELETE cascade ON UPDATE no action;
