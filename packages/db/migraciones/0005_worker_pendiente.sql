ALTER TABLE "pipeline_runs" DROP CONSTRAINT "pipeline_runs_status_check";
--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_status_check" CHECK (status in ('pendiente', 'en_curso', 'completado', 'fallido'));
--> statement-breakpoint
ALTER TABLE "pipeline_steps" DROP CONSTRAINT "pipeline_steps_status_check";
--> statement-breakpoint
ALTER TABLE "pipeline_steps" ADD CONSTRAINT "pipeline_steps_status_check" CHECK (status in ('pendiente', 'en_curso', 'completado', 'fallido'));
