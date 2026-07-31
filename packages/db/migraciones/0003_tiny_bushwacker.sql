ALTER TABLE "organizations" ADD COLUMN "slug" text;
--> statement-breakpoint
UPDATE "organizations" SET "slug" = 'principal'
  WHERE "id" = (SELECT "id" FROM "organizations" ORDER BY "created_at" LIMIT 1);
--> statement-breakpoint
UPDATE "organizations" SET "slug" = 'org-' || left(replace("id"::text, '-', ''), 8)
  WHERE "slug" IS NULL;
--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "slug" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_slug_unique" UNIQUE("slug");