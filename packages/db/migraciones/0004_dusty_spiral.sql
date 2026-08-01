ALTER TABLE "plan_slots" DROP CONSTRAINT "plan_slots_source_org_fk";
--> statement-breakpoint
ALTER TABLE "plan_slots" ADD CONSTRAINT "plan_slots_source_org_fk" FOREIGN KEY ("source_slot_id","organization_id") REFERENCES "public"."plan_slots"("id","organization_id") ON DELETE no action ON UPDATE no action;
