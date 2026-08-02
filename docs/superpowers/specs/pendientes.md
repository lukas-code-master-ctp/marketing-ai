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

## Prioridad 1 — insumos para el diseño de la Fase 1

Cuatro cosas que la revisión de rama destapó y que la UI tiene que resolver desde su diseño, no después.

### 1. El CLI no sabe reanudar una corrida

Partir P1 y P2 en dos pasos evita recobrar el modelo **dentro de una misma invocación**. Pero `apps/cli/src/comandos.ts` nunca pasa `runId` y el CLI no expone bandera de reanudación, así que si la persistencia agota sus cinco reintentos —Postgres caído más de medio minuto— el proceso termina, el usuario vuelve a correr el comando, nace una corrida nueva y **el modelo se cobra otra vez**. La grilla ya pagada queda en `pipeline_steps.output` de la corrida fallida, inalcanzable.

El motor ya soporta reanudar (`ejecutarFlujo` acepta `ctx.runId`, `reanudarCorrida` está probado). Falta exponerlo. La UI de Fase 1 lo va a necesitar de todos modos: una bandeja que muestre corridas fallidas con un botón de reintentar es exactamente esto.

### 2. Nada filtra por `status = 'descartado'`

La decisión de la cascada convierte `descartado` en el mecanismo normal de la UI para quitar un slot. Pero `verGrilla` selecciona sin filtrar por estado y `FilaDeGrilla` ni expone el campo; `SalidaP2.totalSlots` los cuenta; y `expandirDerivados` y `validarGrilla` tampoco los miran, así que una regeneración los recontaría en las reglas de cadencia y de distribución de pilares.

Hoy no está roto porque no existe la ruta de descarte. La Fase 1 es su primer consumidor.

### 3. La salida entre pasos no está versionada

`SalidaDeLaPropuesta` viaja como jsonb entre los dos pasos de P2, y ahora carga el perfil de marca y la estrategia completos. Ninguna prueba la hace cruzar una reanudación real: el reintento intra-invocación devuelve el objeto en memoria. Todo el contenido es JSON puro, así que hoy el viaje es inofensivo.

El problema aparece junto con el punto 1: una corrida vieja cuyo primer paso se completó con una versión anterior del código tiene una salida de forma incompatible, y el segundo paso la desestructura a `undefined`. Falla ruidosamente, no en silencio — pero conviene versionar la salida **antes** de exponer el botón de reanudar.

### 4. Tres nombres para el mismo concepto

`brandSlug` en las interfaces y el contexto, `nombreVisible` en los parámetros de `costos.ts`, `repositorio.ts` y `p2.ts`, y `slug` en los argumentos del CLI. Además `ReferenciaResuelta` y `ReferenciaDeMarca` son hoy estructuras idénticas declaradas por separado, que coinciden por accidente. Unificar antes de que la web sume un cuarto nombre.

---

## Cerrado: las tres decisiones previas a la Fase 1

Resueltas en `feat/decisiones-previas-fase-1`. El detalle de cada una queda abajo como registro de por qué se eligió lo que se eligió.

## Prioridad 1 — insumos para el diseño de los bloques 1B y 1C

De la revisión de rama de `feat/app-web-1a`.

### 1. La selección de "estrategia vigente" vive en tres lugares

`cargarEstrategiaVigente` (`@gc/strategy/p2.ts`), `cargarEstrategiaDelTrimestre` (`@gc/operaciones/grilla.ts`) y `estrategiaDelTrimestre` (`@gc/operaciones/perfiles.ts`). Las tres leen la estrategia de un trimestre; las dos primeras excluyen archivadas y la tercera no, deliberadamente, porque muestra en vez de calcular. Los nombres no delatan la diferencia. Una cuarta copia es peor que tres: extraer una sola con la política como parámetro.

### 2. La web no está aislada del modelo por código, solo por convención

`@gc/operaciones` reexporta `flujos.ts` desde su barril, que arrastra `@gc/strategy` y con él `@gc/ai` al proceso del servidor web. Hoy es inofensivo —`@gc/ai` no tiene efectos de módulo— pero la regla "la web nunca llama al modelo" es una línea en un `package.json`, no una garantía.

El arreglo es el patrón que ya se usó al resolver un problema de bundle en esta misma rama: subrutas de exportación. `@gc/operaciones/flujos` para el CLI, y que la web importe solo lo que consume.

### 3. Falta reabrir una grilla desde la web

`grilla:reabrir` existe en el CLI. La bandeja de aprobación de la Fase 1 debería ofrecerlo, porque aprobar deja el mes inmutable y hoy volver atrás exige terminal.

### 4. Lo que el renderizado sin pruebas cuesta, en concreto

Nada verifica, y fallaría en silencio: que las fichas descartadas se lean como descartadas; que cada slot caiga en una celda; que "Reintentar" repita la operación que falló; que el foco entre al diálogo y vuelva al disparador; que el número de versión del perfil sea el recién guardado.

Lo que sí sobrevive sin pruebas de renderizado es todo lo que la capa de dominio revalida por su cuenta. Esa es la línea: las derivaciones del cliente que deciden escrituras deben vivir en funciones puras probadas — como se hizo con `derivadosVigentesDe` — y no en componentes.

### 5. Deuda menor registrada

`EditorDePerfil` lee la versión de props y no del retorno de la acción; `layout.tsx` y `page.tsx` resuelven la organización por separado en cada petición; un GET a `/` puede crear la organización por defecto; los slots fuera de las semanas renderizadas no se muestran pero sí cuentan; el texto editado no tiene cota de longitud; el manifiesto de dependencias de `apps/web` declara `@gc/brand` sin usarlo y omite dos que transpila.

---

## Prioridad 1 — decidido, implementado

Las tres decisiones se cerraron el 2026-07-31. Lo que sigue es el enfoque acordado, con el detalle técnico que la implementación necesita.

### 1. Borrar un slot no se lleva sus derivados

**Decisión:** `ON DELETE NO ACTION` en la autorreferencia de `plan_slots`, y la UI nunca borra — marca `status = 'descartado'`, valor que la tabla ya tiene.

**Por qué `NO ACTION` y no `RESTRICT`:** `persistir` borra padres e hijos en una sola sentencia al regenerar un mes. `RESTRICT` se verifica de inmediato y rompería ese camino; `NO ACTION` se verifica al final de la sentencia, cuando los hijos ya se fueron, así que permite el borrado masivo y bloquea el borrado de un padre suelto. La diferencia decide si esto funciona.

Migración de una línea. La garantía queda en la base y no en la convención, así que un endpoint de borrado escrito sin cuidado falla fuerte en vez de llevarse cuatro piezas de contenido en silencio.

### 2. Los mensajes nombran la marca por su slug

**Decisión:** propagar el slug junto al `brandId`.

Cinco mensajes en tres paquetes muestran hoy el UUID: `p2.ts`, `p1.ts`, `brand/repositorio.ts` y dos en `ai/costos.ts`. Todos en español, todos explican el remedio, y todos terminan mostrando algo que el usuario nunca escribió:

> `Error: La marca 099bfa3c-b27d-4f93-8d24-fe822defdfa1 no tiene estrategia vigente para 2026-Q4.`

`ContextoDePaso` ya lleva `brandId?`; se le agrega `brandSlug?`, lo que lo pone al alcance de P1, P2 y de todo lo que reciba el contexto. `verificarPresupuesto`, `exigirPresupuesto` y `cargarPerfilVigente` reciben `brandId` suelto y necesitan un parámetro más para mostrar. El campo va **opcional**, de modo que nada se rompe si falta.

No es un defecto de P2 sino una consecuencia de que `brandId` sea lo único que cruza la frontera `apps/cli` → `@gc/*`. Arreglar uno solo deja los otros cuatro y crea una inconsistencia nueva.

### 3. La llamada al modelo y la persistencia son pasos distintos

**Decisión:** partir el paso en dos, tanto en P1 como en P2.

El paso `proponer_grilla` es hoy una sola unidad de reintento que contiene cuatro consultas, **una o dos llamadas pagadas al modelo de razonamiento**, y una transacción de escritura al final. Antes de que los errores de Postgres entraran a la taxonomía, un `53300` o un `08006` al persistir era permanente: una falla, un gasto. Ahora se reintenta el paso entero, incluidas las llamadas ya pagadas y ya registradas en `ai_calls`. Con `maxIntentos` en 5, un solo `grilla:generar` puede cobrar cinco ciclos de razonamiento por un fallo que no tuvo nada que ver con el modelo.

El corte:

- **P2 paso 1** — comprobar estado, presupuesto, cargar perfil y estrategia, proponer, validar y reparar. Su salida es la grilla validada, que ya es JSON serializable.
- **P2 paso 2** — expandir derivados, revalidar el conjunto expandido y persistir en transacción. Determinístico salvo por la base.
- **P1** se parte igual: generar contra el modelo, y persistir aparte.

El motor ya guarda la salida de cada paso y salta los completados, así que al reintentar solo se reejecuta la persistencia. No hace falta maquinaria nueva: es exactamente para lo que existe la clave de idempotencia. Efecto secundario deseable: el sistema queda reanudable con más finura.

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
