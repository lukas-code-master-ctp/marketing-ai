# Pendientes

**Última actualización:** 2026-08-01, tras la rama `feat/deuda-insumos-1b-1c`
**Origen:** las revisiones adversariales de rama completa de las cinco ramas fusionadas hasta hoy, más los hallazgos menores acumulados en sus revisiones por tarea.

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

La decisión de la cascada convierte `descartado` en el mecanismo normal de la UI para quitar un slot. Pero `SalidaP2.totalSlots` los cuenta, y `expandirDerivados` y `validarGrilla` tampoco los miran, así que una regeneración los recontaría en las reglas de cadencia y de distribución de pilares.

Hoy no está roto porque nada regenera un mes que ya tuvo descartes. El worker de 1B es su primer consumidor real.

**Parcialmente cerrado en `feat/app-web-1a`:** `verGrilla` sí selecciona `status` y `FilaDeGrilla` sí expone `descartado`; `grillaDelMes` los excluye de `porCanal` y de los problemas que recalcula. Lo que sigue abierto es el camino de generación, que es el que importa para 1B.

### 3. La salida entre pasos no está versionada

`SalidaDeLaPropuesta` viaja como jsonb entre los dos pasos de P2, y ahora carga el perfil de marca y la estrategia completos. Ninguna prueba la hace cruzar una reanudación real: el reintento intra-invocación devuelve el objeto en memoria. Todo el contenido es JSON puro, así que hoy el viaje es inofensivo.

El problema aparece junto con el punto 1: una corrida vieja cuyo primer paso se completó con una versión anterior del código tiene una salida de forma incompatible, y el segundo paso la desestructura a `undefined`. Falla ruidosamente, no en silencio — pero conviene versionar la salida **antes** de exponer el botón de reanudar.

### 4. Tres nombres para el mismo concepto

`brandSlug` en las interfaces y el contexto, `nombreVisible` en los parámetros de `costos.ts`, `repositorio.ts` y `p2.ts`, y `slug` en los argumentos del CLI. Además `ReferenciaResuelta` y `ReferenciaDeMarca` son hoy estructuras idénticas declaradas por separado, que coinciden por accidente. Unificar antes de que la web sume un cuarto nombre.

---

## Cerrado: las tres decisiones previas a la Fase 1

Resueltas en `feat/decisiones-previas-fase-1`. El detalle de cada una queda abajo como registro de por qué se eligió lo que se eligió.

## ✅ Cerrado: los cinco insumos para 1B y 1C

Resueltos en `feat/deuda-insumos-1b-1c` ([diseño](2026-08-01-deuda-insumos-1b-1c-design.md) · [plan](../plans/2026-08-01-deuda-insumos-1b-1c.md)).

1. **La selección de "estrategia vigente" quedó en una sola función.** `leerEstrategiaDelTrimestre`, en `@gc/strategy/estrategias.ts`, con la política de archivadas como parámetro explícito en cada sitio de llamada. Las tres copias diferían en cuatro ejes que ningún nombre delataba, y la de `perfiles.ts` ni siquiera validaba: devolvía la columna cruda y dejaba parseando a la página, así que una estrategia corrupta se comportaba distinto según por dónde se entrara. Ahora sale como `invalida` por los tres caminos.

2. **La web no puede alcanzar el modelo, y hay algo que lo comprueba.** `p1`, `p2`, `tipos`, los prompts y los dos flujos de generación salieron a `@gc/flujos`; `@gc/strategy` y `@gc/operaciones` soltaron `@gc/ai` y `@gc/pipeline`. Lo vigila `pnpm comprobar:aislamiento`, que corre en CI.

   **Ojo con cómo se describe esta garantía**, porque costó dos correcciones llegar a decirlo bien: no la da el resolvedor de módulos. Webpack **sí** resuelve `@gc/ai` desde `apps/web`, porque Next agrega el almacén plano de pnpm (`node_modules/.pnpm/node_modules`) a su `resolve.modules`. Lo que bloquea un import escrito a mano es `tsc --noEmit`; lo que vigila la regresión que `tsc` no ve —volver a declarar `@gc/ai` en un paquete del camino, incluso como `devDependency`— es la comprobación. Las dos corren en CI. El detalle está en el §3 del diseño.

3. **Reabrir la grilla desde la web.** Botón en la cabecera cuando el estado es `aprobada`, con confirmación. Los dos textos de la interfaz que mandaban al usuario a la terminal apuntan ahora a la pantalla.

4. **El renderizado tiene arnés.** `jsdom` más `@testing-library/react`, con el entorno pedido por archivo y las Server Actions sustituidas. Las cinco garantías que este punto listaba están afirmadas.

   Lo que este arnés enseñó, y vale más que las pruebas mismas: **cuatro veces apareció una prueba cuyo nombre prometía una mitad que ninguna aserción respaldaba** — «sin degradarlo», «cada slot cae en una celda», «y el vigente no», «se muestra aparte». Todas pasaban. Es el modo de falla característico de este repositorio y el arnés no lo cura: lo hace más fácil de cometer, porque una aserción contra el documento entero se ve igual que una contra el lugar correcto. La defensa que funcionó fue mutar el código y exigir que la prueba se pusiera roja por la razón exacta.

5. **La deuda menor, ítem por ítem.** `EditorDePerfil` lee la versión del retorno de la acción; `React.cache` deduplica la resolución de organización dentro de la petición; un `GET` ya no puede crear la organización (`resolverOrganizacion` recibe permiso, el CLI sí y la web no); los slots fuera de la rejilla se muestran en un grupo aparte, con una función pura probada decidiendo cuáles son; `angulo` y `brief` ganaron `.max(200)` y `.max(2000)`; el manifiesto de `apps/web` quedó sin `@gc/brand` y `transpilePackages` sin `@gc/ai` ni `@gc/pipeline`.

### Lo que esta rama NO cerró, a propósito

- **Las páginas async de servidor siguen sin pruebas de renderizado.** El arnés cubre componentes de cliente; cubrir las rutas exige un navegador real, que es el subsistema que el diseño de 1A descartó y este no revisó.
- **La rama de auto-creación de organización sigue sin ser segura ante concurrencia** (Prioridad 2). Con la web fuera de ese camino, solo queda alcanzable desde el CLI, donde no hay concurrencia.
- **La cota de `angulo`/`brief` no es un invariante**, porque `expandirDerivados` antepone texto. Registrado abajo, en Prioridad 2.

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
- **Una estrategia que salió de borrador no se puede regenerar ni devolver a borrador: no hay salida.** P1 rechaza regenerar cualquier estrategia en `aprobada` o `archivada` (`estadoDeLaEstrategia` más el `setWhere` del upsert), y no existe una operación «reabrir estrategia» gemela de `reabrirGrilla` —ni en el dominio, ni en el CLI, ni en la web—. La pantalla de estrategia ya no manda a correr un comando que va a fallar: cuando la estrategia guardada no valida y está fuera de borrador, explica que el motor solo regenera una en borrador. Es honesto, pero deja al usuario sin remedio alguno, y con una estrategia corrupta que no se puede mostrar ni reemplazar. Encima, el mensaje de `packages/flujos/src/p1.ts` —«Devuélvela a "borrador" para regenerarla»— pide hoy algo que ningún camino del sistema permite hacer: hay que arreglar el mensaje o construir la operación que promete. El arreglo natural es la operación de reabrir, con la misma forma que `reabrirGrilla` (transición explícita, tenencia dentro del `UPDATE`, y solo desde `aprobada`); decidir aparte qué hacer con `archivada`, que hoy tampoco destraba nada.
- La rama de auto-creación de organización no es segura ante concurrencia; el perdedor recibe un error crudo del driver, fuera de la taxonomía y no en español.
- `--mes` no se valida en `grilla:generar` mientras `grilla:ver` sí. `validarMes` ya existe en `periodos.ts` esperando que se levante esta exclusión.

**Costos y contenido**
- Sin tabla de precios de respaldo: `costoUsd: cuerpo.usage?.cost ?? 0`. Un modelo sin `usage.cost` da costo cero en cada llamada y presupuesto efectivamente ilimitado, indistinguible de la marcha en seco.
- `expandirDerivados` descarta en silencio los derivados fuera del mix o en colisión. Devolver `{ derivados, descartados }` y sumarlos a los avisos.
- `expandirDerivados` (`packages/strategy/src/derivados.ts`) antepone texto al ángulo y al brief del padre («Adaptación para {canal}: …», «Adaptar al formato de {canal} la pieza original.\n\n…») antes de las cotas de 200 y 2000 caracteres que valida `esquemas.ts`. Un padre en el límite exacto produce un derivado de 227 y 2052 caracteres que nada rechaza: `SlotDerivado` es solo un tipo, `validarGrilla` no mira longitudes, `persistir` no valida, y la columna es `text` sin `CHECK`. Se persiste en silencio y la interfaz recién lo nota al editar, porque ahí sí valida contra el esquema —el sistema rechaza contenido que él mismo generó, sin explicarle al usuario por qué. Hoy es remoto (las muestras miden 40 y 120 caracteres) pero `GrillaPropuesta` lo permite explícitamente. Tres salidas posibles, sin elegir ninguna: recortar el prefijo al expandir, bajar la cota del padre para dejarle margen al prefijo, o parsear los derivados en `p2.ts` antes de persistir.
- Las reglas bloqueantes de `validacion.ts` y los filtros de `derivados.ts` son dos listas sincronizadas a mano. Agregar una regla sin su filtro gemelo hace fallar la generación en duro después de pagar el modelo.
- `hashDePrompt` usa los mensajes originales, no la conversación: las dos filas de un ciclo de reparación quedan con hash idéntico y no se puede saber cuál prompt produjo cada una.

**CI y web**
- **CI no carga el `.env` de la raíz, así que no verifica la regla del `.env` único.** El workflow inyecta `DATABASE_URL_TEST` como variable de entorno del job y no hay ningún `.env` en el checkout, de modo que el `config({ path })` de `vitest.setup.ts` es un no-op allá. Consecuencia: una regresión en cómo se resuelve el `.env` único —una ruta relativa mal calculada, un paquete que deja de cargar el setup— dejaría CI en verde y solo aparecería al clonar en local. La regla existe justamente porque romperla ya costó trabajo, y el único lugar donde se ejercita es la máquina de quien programa. En la misma clase: `packages/shared/vitest.config.ts` es el único de los diez sin `setupFiles`. Hoy es benigno y preexistente —`@gc/shared` no toca la base ni el entorno— pero es la misma manera de quedar fuera de la garantía sin que nada lo diga.
- **El botón "Reintentar" no lleva `disabled={ocupado}`, mientras el botón principal del mismo componente sí.** Pasa en `EditorDePerfil.tsx`, `BotonAprobarGrilla.tsx`, `BotonReabrirGrilla.tsx` y `PanelDeDetalle.tsx`: el disparador original se deshabilita mientras la operación corre y el de reintentar no, así que un doble clic durante un reintento dispara dos llamadas a la misma Server Action. Es preexistente —viene de los primeros componentes de 1A— y la rama `feat/deuda-insumos-1b-1c` lo propagó al componente nuevo al copiar el patrón. El arreglo es de una línea por sitio; lo que vale la pena es hacerlo en los cuatro a la vez y dejarlo afirmado en el arnés de componentes, que ya sabe simular clics. `FormularioDeMarca.tsx`, que estrenó su "Reintentar" después, sí lo lleva: son cuatro sitios, no cinco.
- **La primera marca de un clon nuevo sigue exigiendo la terminal.** `apps/web/src/datos.ts` resuelve la organización con `crearSiFalta: false` —y esa decisión es correcta: un `GET /` no debe escribir, y menos por la rama que no es segura ante concurrencia—, así que sin ninguna organización en la base la petición falla con el mensaje que manda a `pnpm cli marca:crear`. Consecuencia: el texto «Crea la primera acá» de la pantalla raíz solo se ve cuando ya existe una organización **sin** marcas, que es el estado en el que queda quien borró sus marcas, no el de quien acaba de clonar. La promesa de crear una marca «sin tocar la terminal» queda entonces a medias justo en el caso de arranque, que es donde más pesa. Las salidas posibles, ninguna elegida: una operación explícita de "crear organización" en la web —una escritura pedida, que es distinto de un `GET` que escribe—; un comando de arranque que solo cree la organización; o aceptar el caso y decirlo en el mensaje, que hoy nombra un comando que además crea una marca.
- **Hay una aserción que hoy no puede fallar en `apps/web/src/paginas.test.tsx`**: `expect(screen.queryByText(/pnpm cli/)).toBeNull()`, dentro de «sin perfil abre el editor con la plantilla de partida y no manda al CLI». Ese texto ya no existe en ninguna parte de la web, así que la mitad "y no manda al CLI" del nombre de la prueba no está sostenida por nada que pueda romperse hoy: la aserción no distingue el código correcto del incorrecto porque no hay incorrecto que probar. Como guarda contra reintroducirlo es legítima —el estado vacío del perfil remitía al CLI hasta la Task 8— y por eso se deja; lo que queda registrado es que no cuenta como cobertura, y que la garantía real de esa prueba es la otra mitad, la que afirma que el editor se siembra con la plantilla.

**Worker y corridas**
- **No hay latido: distinguir una corrida viva de una abandonada es hoy una aproximación por tiempo.** `reanudarCorridaEncolada` acepta una corrida `en_curso` solo si lleva quince minutos sin dar señales, y la única señal disponible es la marca de tiempo más reciente entre la propia corrida y sus pasos. Es una aproximación, no una respuesta: nada la vuelve verdadera. Un paso que tarde más que el umbral —una llamada al modelo lenta con reintentos, o un modelo nuevo más caro en tiempo— parece abandonado aunque el worker siga adentro, y reanudarlo pone a dos workers en el mismo paso pagando el modelo dos veces. Al revés, un worker que muere justo después de escribir un paso se ve vivo durante quince minutos. Lo correcto es un **latido o un arriendo que el worker renueve** —una columna `lease_until` en `pipeline_runs` que el worker refresque mientras trabaja, y que caduque sola si el proceso muere—, con lo que la pregunta pasa a tener respuesta en vez de estimación. El umbral alcanza mientras haya un worker de bucle secuencial: ahí nadie reanuda una corrida propia a mitad. Deja de alcanzar en cuanto haya varias instancias, que es lo que trae llevar el worker a la nube. La misma columna resolvería el barrido automático que falta (ver "Cobertura de pruebas ausente").
- **El aviso de "nadie tomó esta generación" tiene un falso positivo, y es el mismo problema del latido.** `EstadoDeCorrida` anuncia que el worker no está corriendo cuando una corrida lleva más de treinta segundos en `pendiente`. Pero el worker es secuencial: una corrida encolada mientras él está ocupado con otra —que tarda minutos, son llamadas al modelo— cruza el umbral sin que nada esté mal, y la pantalla afirma como un hecho que el worker no corre. Subir el umbral no lo arregla, solo cambia el tamaño de la ventana en la que miente: mientras la única señal sea "cuánto lleva encolada", no hay forma de distinguir "nadie la va a tomar" de "el que la va a tomar está ocupado". La solución honesta es la misma columna de latido o arriendo del punto anterior: con un worker que marque que está vivo, la pantalla puede decir «el worker está trabajando en otra generación» en vez de «el worker no está corriendo». Nota de contexto: el otro falso positivo de este mismo panel —el que aparecía al reanudar, porque `encoladaHace` seguía contando desde el encolado original— sí se arregló: reanudar reinicia la marca de tiempo de la corrida.

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
- La guarda `ne(status, 'fallido')` de `registrarFallo` en el worker no es falsable por caja negra: el motor y el worker producen el mismo texto por construcción —`mensaje()` está duplicada— así que quitarla no rompe ninguna prueba. No es código muerto: el `UPDATE` sí escribe en los tres casos donde el motor no llegó a marcar nada (flujo desconocido, fallo en el preámbulo del motor, fallo al crear la corrida). Afirmarla exige exportar la función interna y probarla directa.
- Nada recupera una corrida colgada en `en_curso`. Si el worker muere a mitad —o lo matan sin darle tiempo a terminar el turno—, la fila queda así para siempre, indistinguible de una que sigue ejecutándose. El botón de reanudar de una tarea futura la cubre desde la interfaz, pero no hay barrido automático.

---

## Descartado a propósito

- **Guardia de concurrencia** sobre el check-then-act de la clave de idempotencia. No hay concurrencia en el sistema todavía.
- **Volver determinista la prueba de carrera de `guardarPerfil`.** El bloqueo `FOR UPDATE` es la garantía real; el propio test lo dice.
- **Comentar en `0001` que `0002` la supera.** Rompería su identidad byte a byte con el commit que la aplicó, que es la evidencia del argumento de convergencia. `0002` ya lleva el comentario y es la que se lee al depurar.
- **`--org ""` tratado como no indicado.** Nunca elige la organización equivocada en silencio, que es el defecto que importa.
- **`clasificarError` acepta cualquier objeto con `code` string.** El riesgo está vacío: el cliente del modelo siempre envuelve en `ErrorDeDominio`, y los códigos nativos de Node son alfabéticos mientras los SQLSTATE transitorios empiezan con dígito.
