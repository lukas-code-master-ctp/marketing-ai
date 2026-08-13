/**
 * Los cinco canales del dominio, y nada más. Vive aparte de `esquema.ts` —y
 * con su propia entrada en `exports`, `@gc/db/canales`— porque quien lo
 * necesita es `EditorDeEncargo`, un componente de cliente de `apps/web`.
 * Importarlo del barril `@gc/db` arrastraría `cliente.ts` —el conector de
 * Cloud SQL, con `google-auth-library`— al bundle del navegador; importarlo
 * de `esquema.ts` arrastraría el DDL de las doce tablas (`pgTable(...)` de
 * las doce, porque `@gc/db` no declara `sideEffects: false` y webpack no
 * puede descartar esas llamadas). Mismo problema, mismo remedio que ya usa
 * `@gc/operaciones/senales` para `EstadoDeCorrida`: un módulo tallado a
 * propósito para el componente de cliente, sin nada más colgando.
 *
 * `esquema.ts` reexporta desde acá en vez de declarar su propia copia, para
 * que siga habiendo una sola fuente de verdad.
 */
export const CANALES = ['instagram', 'linkedin', 'facebook', 'tiktok', 'blog'] as const
export type Canal = (typeof CANALES)[number]
