CREATE TABLE "model_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"level" text NOT NULL,
	"model_id" text NOT NULL,
	"label" text NOT NULL,
	"description" text NOT NULL,
	"modality" text DEFAULT 'chat' NOT NULL,
	"price_input_usd" numeric(10, 4) NOT NULL,
	"price_output_usd" numeric(10, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_catalog_level_model_unique" UNIQUE("level","model_id"),
	CONSTRAINT "model_catalog_level_check" CHECK (level in ('razonamiento', 'redaccion', 'utilitario')),
	CONSTRAINT "model_catalog_modality_check" CHECK (modality in ('chat', 'imagen'))
);
--> statement-breakpoint
CREATE TABLE "organization_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"level" text NOT NULL,
	"principal_id" uuid NOT NULL,
	"respaldo_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "organization_models_org_level_unique" UNIQUE("organization_id","level"),
	CONSTRAINT "organization_models_level_check" CHECK (level in ('razonamiento', 'redaccion', 'utilitario'))
);
--> statement-breakpoint
ALTER TABLE "organization_models" ADD CONSTRAINT "organization_models_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "organization_models" ADD CONSTRAINT "organization_models_principal_id_model_catalog_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."model_catalog"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "organization_models" ADD CONSTRAINT "organization_models_respaldo_id_model_catalog_id_fk" FOREIGN KEY ("respaldo_id") REFERENCES "public"."model_catalog"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "organization_models" ADD CONSTRAINT "organization_models_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "model_catalog" ("level", "model_id", "label", "description", "price_input_usd", "price_output_usd") VALUES
('razonamiento', 'upstage/solar-pro4', 'Económico', 'El más barato para razonar sobre la grilla, para cuando el presupuesto manda.', 0.0300, 0.1200),
('razonamiento', 'poolside/laguna-xs-2.1', 'Equilibrado', 'Un punto medio entre costo y calidad para el razonamiento del día a día.', 0.0600, 0.1200),
('razonamiento', 'deepseek/deepseek-v4-flash-0731', 'Probado', 'El que hoy razona la grilla en producción, con historial de uso confiable.', 0.1400, 0.2800),
('razonamiento', 'tencent/hy3', 'Alternativo', 'Respaldo cuando el modelo probado no responde o falla.', 0.1320, 0.5280),
('redaccion', 'deepseek/deepseek-v4-flash-0731', 'Económico', 'La opción más barata para redactar piezas de bajo riesgo.', 0.1400, 0.2800),
('redaccion', 'anthropic/claude-sonnet-5', 'Recomendado', 'El que mejor equilibra calidad de escritura y costo para redactar contenido de marca.', 2.0000, 10.0000),
('redaccion', 'moonshotai/kimi-k3', 'Alternativo', 'Un estilo de escritura distinto para comparar contra el recomendado.', 3.0000, 15.0000),
('redaccion', 'anthropic/claude-opus-5', 'El más capaz', 'El modelo de mayor calidad disponible, para piezas que exigen lo mejor.', 5.0000, 25.0000);
--> statement-breakpoint
INSERT INTO "organization_models" ("organization_id", "level", "principal_id", "respaldo_id")
SELECT
	o."id",
	'razonamiento',
	(SELECT "id" FROM "model_catalog" WHERE "level" = 'razonamiento' AND "model_id" = 'deepseek/deepseek-v4-flash-0731'),
	(SELECT "id" FROM "model_catalog" WHERE "level" = 'razonamiento' AND "model_id" = 'tencent/hy3')
FROM "organizations" o;
--> statement-breakpoint
INSERT INTO "organization_models" ("organization_id", "level", "principal_id", "respaldo_id")
SELECT
	o."id",
	'redaccion',
	(SELECT "id" FROM "model_catalog" WHERE "level" = 'redaccion' AND "model_id" = 'anthropic/claude-sonnet-5'),
	(SELECT "id" FROM "model_catalog" WHERE "level" = 'redaccion' AND "model_id" = 'deepseek/deepseek-v4-flash-0731')
FROM "organizations" o;
