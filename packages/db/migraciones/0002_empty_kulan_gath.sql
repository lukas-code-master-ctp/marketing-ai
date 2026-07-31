-- MIGRACIÓN ESCRITA A MANO. No regenerar con `drizzle-kit generate` sin releer
-- esto: drizzle-kit 0.28 no sabe expresar la lista de columnas del `SET NULL`
-- y volvería a emitir la forma rota. Ver los comentarios en `src/esquema.ts`,
-- sobre `contentPlans.estrategiaPorOrg` y `aiCalls.corridaPorOrg`.
--
-- Deliberadamente SIN el envoltorio `DO $$ ... EXCEPTION WHEN duplicate_object`
-- que usan las FK de 0001: si una restricción ya existiera con la definición
-- vieja, el envoltorio se la saltaría en silencio y la base quedaría rota sin
-- que nada lo avisara. Acá queremos que falle fuerte.
--
-- Dos arreglos:
--
-- 1) `content_plans.strategy_id` quedaba fuera del límite multi-tenant: la
--    tabla original de once claves lo omitió, así que un plan de la
--    organización A podía referenciar una estrategia de la B. P2 lee la
--    estrategia del plan, o sea que un join servía la estrategia de otro
--    inquilino. Pasa a compuesta (strategy_id, organization_id).
--
-- 2) `ai_calls_run_org_fk` se creó en 0001 con `ON DELETE set null` a secas.
--    Sobre una compuesta eso anula TODAS las columnas, y `organization_id` es
--    NOT NULL: borrar un `pipeline_run` con `ai_calls` colgando falla con
--    23502 en vez de conservar el registro de costo, que es lo que suma el
--    guardián de presupuesto. 0001 NO se edita (ya fue aplicada en bases
--    ajenas y el journal no la reejecutaría); se reemplaza acá, de modo que
--    cualquier base converge sola sin importar en qué estado estuviera.

ALTER TABLE "content_plans" DROP CONSTRAINT "content_plans_strategy_id_strategies_id_fk";--> statement-breakpoint
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_id_organization_id_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_strategy_org_fk" FOREIGN KEY ("strategy_id","organization_id") REFERENCES "public"."strategies"("id","organization_id") ON DELETE SET NULL ("strategy_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_calls" DROP CONSTRAINT "ai_calls_run_org_fk";--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_run_org_fk" FOREIGN KEY ("run_id","organization_id") REFERENCES "public"."pipeline_runs"("id","organization_id") ON DELETE SET NULL ("run_id") ON UPDATE no action;
