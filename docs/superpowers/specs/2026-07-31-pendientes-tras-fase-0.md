# Pendientes tras la Fase 0 y el núcleo de la Fase 1

**Fecha:** 2026-07-31
**Origen:** revisión adversarial de toda la rama `feat/motor-estrategia`, más los hallazgos menores acumulados en las once revisiones por tarea.

Todo lo que sigue se descartó deliberadamente del alcance de ese plan. Nada de esto rompe el sistema hoy; todo es más barato de arreglar ahora que después de que la Fase 1 construya encima.

---

## Prioridad 1 — hacer antes de que la Fase 1 avance

### 1. Clasificar los errores de Postgres

`esTransitorio()` devuelve `false` para todo lo que no sea un `ErrorDeDominio`, y es el único punto donde el motor decide si reintentar. Ninguna llamada a la base está envuelta, así que un reinicio de conexión, un deadlock (`40P01`) o una falla de serialización (`40001`) —transitorios de manual— se tratan como permanentes: sin reintento, corrida marcada `fallido`, y los tokens del modelo ya gastados.

Falta la otra mitad de la taxonomía: un `clasificarPostgres(codigo)` junto a `clasificarHttp` en `@gc/shared`, y envolver las llamadas a la base en los caminos calientes.

**Por qué subió de prioridad:** dos arreglos de la revisión final ensancharon esta superficie. Ahora se escribe en `ai_calls` después de *cada* llamada al modelo, no solo de las exitosas, y `persistir` en P2 corre dentro de una transacción — que introduce precisamente las clases de error que hoy se malinterpretan.

### 2. Hacer exigible la multi-tenencia en la base de datos

Cada tabla lleva `organization_id`, pero es un valor que provee quien llama y que la base nunca contrasta contra el `brand_id` de la misma fila. Las FK son independientes; nada obliga a que concuerden. La frontera hoy se sostiene solo en que los ids de marca son UUID inadivinables.

La corrección es una migración sin datos: `UNIQUE (id, organization_id)` en `brands`, más claves foráneas compuestas `(brand_id, organization_id)` en las tablas hijas. Con datos reales y una UI encima, pasa a ser un backfill con verificación.

Relacionado, en el CLI: `asegurarOrganizacion` usa `.limit(1)` sin `ORDER BY`, y `resolverMarca` empareja solo por `slug` cuando la restricción única real es `(organization_id, slug)`. Ambos son lo primero que se rompe cuando exista una segunda organización.

### 3. `cargarEstrategiaVigente` elige mal

En `p2.ts` toma la estrategia más reciente sin mirar periodo ni estado. Una estrategia `archivada` —justo la que P1 se niega a pisar— es entrada válida para P2. Y como el upsert de P1 no toca `created_at`, "la más reciente" sigue la primera creación, no la última edición.

**Se volvió más consecuente:** esa estrategia ahora decide, vía `mixDeCanales`, *qué derivados existen*. Elegir la equivocada ya no cambia solo el prompt: cambia en silencio la grilla que se persiste.

Sugerido: filtrar `status <> 'archivada'` y preferir la estrategia cuyo periodo contenga el mes.

---

## Prioridad 2 — deuda real, sin urgencia

- **Sin tabla de precios de respaldo.** `costoUsd: cuerpo.usage?.cost ?? 0`. Un modelo o una respuesta sin `usage.cost` da costo 0,00 en cada llamada y presupuesto efectivamente ilimitado, indistinguible de la marcha en seco. Los tokens ya se guardan; falta tarifarlos.
- **`expandirDerivados` descarta en silencio.** Una regla de reciclaje que apunta fuera del mix, o que siempre choca, produce cero derivados sin dejar rastro. Devolver `{ derivados, descartados }` y sumarlos a los avisos. Mitigante actual: como los avisos se calculan tras la expansión, aparece indirectamente como aviso de cadencia.
- **Dos listas sincronizadas a mano.** Las reglas bloqueantes de `validacion.ts` y los filtros de `derivados.ts` deben coincidir, y nada lo obliga. Agregar una regla bloqueante sin su filtro gemelo hace que la generación falle en duro *después* de pagar hasta cuatro llamadas al modelo. Que `expandirDerivados` reutilice `validarGrilla` sobre el conjunto acumulado.
- **`grilla:generar` no valida `--mes` y `--periodo` no se valida nunca**, mientras `grilla:ver` sí lo hace. `--mes 2026-9` pasa, todos los slots fallan `fuera_de_mes` y el usuario paga dos llamadas al modelo para recibir un muro de texto.
- **`crearMarca` deja escapar el error crudo de Postgres** ante un slug duplicado. Debería ser el primer cliente de `clasificarPostgres`.
- **`main.ts` lanza `Error` planos** en un par de sitios: el borde del CLI queda fuera de la taxonomía.
- **`hashDePrompt` usa los mensajes originales, no la conversación.** Las dos filas de un ciclo de reparación quedan con hash idéntico, así que no se puede saber cuál prompt produjo cada una.
- **`reanudarCorrida` no valida que el nombre del flujo coincida** con `pipeline_runs.flow`. Hoy inalcanzable desde el CLI, que no expone `--run-id`.
- **`@gc/brand` exporta su fixture de pruebas** desde el índice público del paquete.

---

## Cobertura de pruebas ausente

Garantías que hoy nadie afirma, listadas porque su ausencia fue la razón por la que varios defectos de esta rama sobrevivieron a una suite verde:

- Que un fallo transitorio de la base se reintente.
- Que `organization_id` concuerde con el de su marca.
- Que dos marcas con el mismo slug en organizaciones distintas se resuelvan bien.
- Que P2 no use una estrategia archivada.
- Los límites exactos de tolerancia en `validarGrilla` (`diff == 1`, `diff == 0.10`).
- El límite exacto del 80 % de presupuesto y la rama de marca inexistente.
- El salto diciembre → enero en el cálculo de mes.
- La guardia de borrador contra `en_ejecucion` y `cerrada` (hoy solo se ejercita `aprobada`).

---

## Descartado a propósito

- **Guardia de concurrencia** sobre el check-then-act de la clave de idempotencia. No hay concurrencia en este plan. Anotar que el perdedor de la carrera recibiría un error crudo del driver, lo que lo vuelve dependiente del punto 1.
- **Volver determinista la prueba de carrera de `guardarPerfil`.** No reproduce su carrera localmente y el propio test lo dice. El bloqueo `FOR UPDATE` es la garantía real; la prueba no.
- **`reanudarCorrida` con `SELECT` + `UPDATE` en vez de un `UPDATE ... RETURNING` atómico.** Dos viajes en una operación manual.
