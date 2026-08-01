# Pendientes

**Última actualización:** 2026-07-31, tras la rama `feat/integridad-prioridad-1`
**Origen:** las revisiones adversariales de rama completa de `feat/motor-estrategia` y `feat/integridad-prioridad-1`, más los hallazgos menores acumulados en las dieciséis revisiones por tarea.

Nada de esto rompe el sistema hoy. Está ordenado por cuánto más caro se vuelve cada cosa una vez que la Fase 1 construya encima.

---

## ✅ Cerrado: los tres puntos de Prioridad 1 originales

Resueltos en `feat/integridad-prioridad-1` ([diseño](2026-07-31-prioridad-1-integridad-design.md) · [plan](../plans/2026-07-31-integridad-prioridad-1.md)):

1. **Los errores de Postgres entran a la taxonomía de reintentos.** `clasificarError` clasifica por SQLSTATE en el único punto donde el motor decide reintentar, así que cubre toda llamada a la base del repositorio — incluidas las que se escriban después.
2. **La multi-tenencia es exigible por la base.** Cinco únicas `(id, organization_id)` y doce claves foráneas compuestas. Más `organizations.slug` y un CLI que resuelve la organización explícitamente en vez de elegir en silencio.
3. **P2 exige la estrategia del trimestre que contiene el mes.** Se acabó "la más reciente por fecha de creación", que ignoraba periodo y estado.

---

## Prioridad 1 — decidir antes de que la UI de Fase 1 exista

### 1. La semántica de la cascada en la autorreferencia de `plan_slots`

`plan_slots.source_slot_id` tiene `ON DELETE CASCADE`. Hoy no muerde porque nadie borra un slot suelto — `persistir` borra el plan entero. El día que la UI ofrezca "eliminar este slot", borrar un artículo de blog se lleva sus cuatro adaptaciones sin avisar.

`plan_slots.status` ya tiene el valor `'descartado'`, o sea que el diseño ya prefiere descartar sobre borrar. Si esa es la respuesta, `ON DELETE RESTRICT` es más honesto que `CASCADE`. **Es una decisión de producto, y cambiarla después de que la UI exista cuesta migración más cambio de interfaz.**

### 2. Los mensajes al usuario imprimen UUID de marca, no el slug

Cinco mensajes en tres paquetes: `p2.ts`, `p1.ts`, `brand/repositorio.ts` y dos en `ai/costos.ts`. Todos en español, todos explican el remedio, y todos terminan mostrando algo que el usuario nunca escribió:

> `Error: La marca 099bfa3c-b27d-4f93-8d24-fe822defdfa1 no tiene estrategia vigente para 2026-Q4.`

No es un defecto de P2 sino una consecuencia sistemática de que `brandId` sea lo único que cruza la frontera `apps/cli` → `@gc/*`. Arreglar solo uno deja los otros cuatro y crea una inconsistencia nueva. La solución coherente es propagar el slug junto al `brandId`: `ContextoDePaso` ya lleva `brandId?`, agregar `brandSlug?` lo pone al alcance de P1, P2 y todo lo que reciba el contexto. **La UI de Fase 1 hereda estos mensajes tal cual si no se decide ahora.**

### 3. El motor reintenta el paso completo — recalibrado, ya es un problema de dinero

El paso `proponer_grilla` es una sola unidad de reintento que contiene cuatro consultas, **una o dos llamadas pagadas al modelo de razonamiento**, y una transacción de escritura al final. Antes de que los errores de Postgres entraran a la taxonomía, un `53300` o un `08006` al persistir era permanente: una falla, un gasto. Ahora se reintenta el paso entero, incluidas las llamadas al modelo ya pagadas y ya registradas.

Con `maxIntentos` en 5, un solo `grilla:generar` puede cobrar cinco veces el ciclo de razonamiento por un fallo que no tuvo nada que ver con el modelo. Lo que contiene el daño es que `exigirPresupuesto` se reejecuta al inicio de cada intento, así que el gasto sigue acotado por el presupuesto mensual — pero un fallo transitorio de base puede consumir el presupuesto restante de una marca en un comando.

Este pendiente venía archivado bajo "importa para la Fase 3". Ya no: importa hoy.

---

## Prioridad 2 — deuda real, sin urgencia

**Integridad que la base todavía no exige**
- Nada garantiza que `content_plans.brand_id = strategies.brand_id`. Dentro de una organización con dos marcas, la base acepta que el plan de una apunte a la estrategia de la otra. Hoy inalcanzable porque `cargarEstrategiaVigente` filtra por marca, pero es el borde exacto donde termina lo que se hizo exigible.
- `plan_slots.source_slot_id` no está restringido al mismo `content_plan_id`: un derivado puede colgar de un slot de otro mes, y entonces el `delete` por plan de `persistir` se lleva en cascada slots ajenos.
- Sin índice del lado referenciante de las cascadas nuevas: `ai_calls.run_id`, `plan_slots.source_slot_id`, `content_plans.strategy_id`. Costo nulo hoy; visible cuando `plan_slots` crezca.

**Mensajes y CLI**
- El mensaje de "no hay estrategia" no distingue "no existe" de "está archivada", y el remedio que sugiere falla con un segundo error distinto. Es un callejón sin salida real: el usuario queda sin remedio documentado.
- La rama de auto-creación de organización no es segura ante concurrencia; el perdedor recibe un error crudo del driver, fuera de la taxonomía y no en español.
- `--mes` no se valida en `grilla:generar` mientras `grilla:ver` sí. `validarMes` ya existe en `periodos.ts` esperando que se levante esta exclusión.

**Costos y contenido**
- Sin tabla de precios de respaldo: `costoUsd: cuerpo.usage?.cost ?? 0`. Un modelo sin `usage.cost` da costo cero en cada llamada y presupuesto efectivamente ilimitado, indistinguible de la marcha en seco.
- `expandirDerivados` descarta en silencio los derivados fuera del mix o en colisión. Devolver `{ derivados, descartados }` y sumarlos a los avisos.
- Las reglas bloqueantes de `validacion.ts` y los filtros de `derivados.ts` son dos listas sincronizadas a mano. Agregar una regla sin su filtro gemelo hace fallar la generación en duro después de pagar el modelo.
- `hashDePrompt` usa los mensajes originales, no la conversación: las dos filas de un ciclo de reparación quedan con hash idéntico y no se puede saber cuál prompt produjo cada una.

**Divergencias documentadas**
- Dos puntos donde el SQL diverge del esquema (`ON DELETE SET NULL (col)`, que drizzle-kit 0.28 no expresa). Ahora cubiertos por la prueba de catálogo, que es preventiva y no solo detectora. Revisar en una actualización de drizzle-kit.

---

## Cobertura de pruebas ausente

Garantías que hoy nadie afirma:

- Que un fallo transitorio de la base se reintente **en el camino de bitácora del paso** (la guarda existe; la prueba cubre el UPDATE, no todas sus variantes).
- Que `organization_id` concuerde con el de su marca en las siete tablas sin prueba conductual — mitigado por la prueba de catálogo, que verifica que las restricciones existan pero no que rechacen.
- Que P2 no use una estrategia de otra marca dentro de la misma organización.
- Los límites exactos de tolerancia en `validarGrilla` (`diff == 1`, `diff == 0.10`).
- El límite exacto del 80 % de presupuesto y la rama de marca inexistente.
- El salto diciembre → enero en el cálculo de mes de `costos.ts`.
- La guardia de borrador contra `en_ejecucion` y `cerrada` (solo se ejercita `aprobada`).

---

## Descartado a propósito

- **Guardia de concurrencia** sobre el check-then-act de la clave de idempotencia. No hay concurrencia en el sistema todavía.
- **Volver determinista la prueba de carrera de `guardarPerfil`.** El bloqueo `FOR UPDATE` es la garantía real; el propio test lo dice.
- **Comentar en `0001` que `0002` la supera.** Rompería su identidad byte a byte con el commit que la aplicó, que es la evidencia del argumento de convergencia. `0002` ya lleva el comentario y es la que se lee al depurar.
- **`--org ""` tratado como no indicado.** Nunca elige la organización equivocada en silencio, que es el defecto que importa.
- **`clasificarError` acepta cualquier objeto con `code` string.** El riesgo está vacío: el cliente del modelo siempre envuelve en `ErrorDeDominio`, y los códigos nativos de Node son alfabéticos mientras los SQLSTATE transitorios empiezan con dígito.
