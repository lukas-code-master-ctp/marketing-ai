ALTER TABLE "ai_calls" DROP CONSTRAINT "ai_calls_brand_id_brands_id_fk";
--> statement-breakpoint
ALTER TABLE "ai_calls" DROP CONSTRAINT "ai_calls_run_id_pipeline_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "approval_policies" DROP CONSTRAINT "approval_policies_brand_id_brands_id_fk";
--> statement-breakpoint
ALTER TABLE "brand_profiles" DROP CONSTRAINT "brand_profiles_brand_id_brands_id_fk";
--> statement-breakpoint
ALTER TABLE "channel_accounts" DROP CONSTRAINT "channel_accounts_brand_id_brands_id_fk";
--> statement-breakpoint
ALTER TABLE "content_plans" DROP CONSTRAINT "content_plans_brand_id_brands_id_fk";
--> statement-breakpoint
ALTER TABLE "pipeline_runs" DROP CONSTRAINT "pipeline_runs_brand_id_brands_id_fk";
--> statement-breakpoint
ALTER TABLE "pipeline_steps" DROP CONSTRAINT "pipeline_steps_run_id_pipeline_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "plan_slots" DROP CONSTRAINT "plan_slots_content_plan_id_content_plans_id_fk";
--> statement-breakpoint
ALTER TABLE "strategies" DROP CONSTRAINT "strategies_brand_id_brands_id_fk";
--> statement-breakpoint
-- ORDEN CORREGIDO A MANO: drizzle-kit emite las UNIQUE al final del archivo,
-- después de las claves foráneas compuestas que las necesitan como destino.
-- Así Postgres aborta en la primera con "there is no unique constraint
-- matching given keys for referenced table". Se movieron las cuatro UNIQUE
-- delante del bloque de FKs. No se cambió ninguna sentencia, solo su orden.
ALTER TABLE "brands" ADD CONSTRAINT "brands_id_organization_id_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_id_organization_id_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_id_organization_id_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "plan_slots" ADD CONSTRAINT "plan_slots_id_organization_id_unique" UNIQUE("id","organization_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_brand_org_fk" FOREIGN KEY ("brand_id","organization_id") REFERENCES "public"."brands"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_run_org_fk" FOREIGN KEY ("run_id","organization_id") REFERENCES "public"."pipeline_runs"("id","organization_id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_policies" ADD CONSTRAINT "approval_policies_brand_org_fk" FOREIGN KEY ("brand_id","organization_id") REFERENCES "public"."brands"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "brand_profiles" ADD CONSTRAINT "brand_profiles_brand_org_fk" FOREIGN KEY ("brand_id","organization_id") REFERENCES "public"."brands"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "channel_accounts" ADD CONSTRAINT "channel_accounts_brand_org_fk" FOREIGN KEY ("brand_id","organization_id") REFERENCES "public"."brands"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_brand_org_fk" FOREIGN KEY ("brand_id","organization_id") REFERENCES "public"."brands"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_brand_org_fk" FOREIGN KEY ("brand_id","organization_id") REFERENCES "public"."brands"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pipeline_steps" ADD CONSTRAINT "pipeline_steps_run_org_fk" FOREIGN KEY ("run_id","organization_id") REFERENCES "public"."pipeline_runs"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plan_slots" ADD CONSTRAINT "plan_slots_plan_org_fk" FOREIGN KEY ("content_plan_id","organization_id") REFERENCES "public"."content_plans"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plan_slots" ADD CONSTRAINT "plan_slots_source_org_fk" FOREIGN KEY ("source_slot_id","organization_id") REFERENCES "public"."plan_slots"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "strategies" ADD CONSTRAINT "strategies_brand_org_fk" FOREIGN KEY ("brand_id","organization_id") REFERENCES "public"."brands"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
