# Worker local y operación desde la web (bloque 1B) — Diseño

**Fecha:** 2026-08-03
**Estado:** Aprobado para planificación
**Alcance:** un paquete nuevo (`apps/worker`), `apps/web`, `@gc/db` con una migración, y los tres insumos de Fase 1 que este bloque destapa.
**No incluye:** agenda mensual, despliegue, autenticación, nube. Eso es 1C.

---

## 1. Por qué

El sistema funciona, pero operarlo exige la terminal: cada marca, cada perfil, cada estrategia y cada grilla nacen de un comando. La app web solo revisa lo que el CLI produjo.

Este bloque cierra esa asimetría: **todo el ciclo se maneja desde el navegador**. Crear una marca, cargarle el perfil, generar su estrategia, generar la grilla del mes, ver cómo va, y reanudar lo que falló.

Lo que **no** cambia es la regla estructural: la capa web nunca ejecuta trabajo largo ni llama al modelo. Generar una estrategia son varias llamadas a un modelo de razonamiento y puede tardar minutos; una petición HTTP que espera eso se corta —en Vercel a los 60 segundos— y cuando se corta, **las llamadas al modelo ya se pagaron** y quedan huérfanas. Es el problema que ya obligó a partir P1 y P2 en dos pasos.

La solución no es que la web haga el trabajo. Es que lo encargue.

---

## 2. Decisiones tomadas

| Decisión | Elección | Razón |
|---|---|---|
| Dónde corre el trabajo largo | **Un worker local, proceso aparte** | Mismo código que después va a Cloud Run; no es trabajo desechable |
| Cómo se encola | **La tabla `pipeline_runs` es la cola** | Ya tiene flujo, entrada, estado y error. Ver §3 |
| Cómo el worker toma trabajo | **Sondeo con `FOR UPDATE SKIP LOCKED`** | Treinta líneas, sin infraestructura nueva, y sobrevive al traslado a la nube |
| Cómo se levanta el worker | **Servicio de `docker compose`** | `docker compose up -d` ya es el comando de arranque; así deja de haber terminal que abrir |
| Dónde se ve el avance | **En la pantalla que disparó la generación** | Cada corrida se encuentra donde vive su resultado; sin pantallas nuevas que mantener |
| Agenda mensual | **Fuera de alcance** | Con el worker local solo dispara si tu máquina está encendida. Rinde recién con el worker en la nube |

---

## 3. La cola

### La tabla que ya existe

`pipeline_runs` tiene hoy `flow`, `input` (jsonb), `status`, `error`, `started_at` y `finished_at`, más las claves foráneas compuestas que garantizan la tenencia. Es una cola a la que le falta un solo estado.

**La migración:** `ESTADOS_PIPELINE` pasa de `en_curso | completado | fallido` a `pendiente | en_curso | completado | fallido`, lo que significa reemplazar el `CHECK` de `pipeline_runs` y el de `pipeline_steps`. Migración nueva, **sin** el envoltorio `DO $$ ... EXCEPTION` —una que se salta sola es peor que una que falla— y sin tocar las cinco que ya se aplicaron.

Nada más cambia en el esquema.

### Dos productores, un consumidor

La web inserta una corrida en `pendiente` y devuelve la pantalla al instante. El CLI **sigue exactamente como hoy**: crea en `en_curso` y ejecuta en línea.

Que existan las dos vías no es duplicación. La del CLI es síncrona y es la vía de escape cuando algo se rompe y quieres ver el error en vivo; la de la web es asíncrona y es la de uso normal. Comparten el motor, que es donde vive la lógica.

### El estado `pendiente` en `pipeline_steps`

El `CHECK` de pasos se amplía igual, por simetría con el enumerado compartido, pero **ningún paso nace `pendiente`**: el motor los crea `en_curso` al empezarlos. Es una consecuencia de compartir la constante, no una capacidad nueva.

---

## 4. El worker

### Qué es

`apps/worker`, un proceso del workspace junto a `apps/cli` y `apps/web`. Su bucle:

```
cada 2 segundos:
  tomarYEjecutarUna()
```

Y `tomarYEjecutarUna()`:

```sql
UPDATE pipeline_runs SET status = 'en_curso'
WHERE id = (
  SELECT id FROM pipeline_runs
  WHERE status = 'pendiente'
  ORDER BY started_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING *
```

Si vuelve fila, resuelve el flujo por su nombre y llama:

```ts
ejecutarFlujo(db, flujoDe(fila.flow), fila.input, {
  organizationId: fila.organizationId, runId: fila.id, brandId: fila.brandId, brandSlug,
})
```

`flujoDe` es un mapa de dos entradas, con los nombres que `pipeline_runs.flow` ya guarda hoy:

| `flow` | Constructor | Pasos |
|---|---|---|
| `p1_estrategia` | `crearFlujoEstrategia(deps)` | `generar_estrategia`, `persistir_estrategia` |
| `p2_grilla` | `crearFlujoGrilla(deps)` | `proponer_grilla`, `persistir_grilla` |

Un `flow` que no esté en el mapa es un error `permanente` que marca la corrida `fallido` sin reintentar: es una fila corrupta o de una versión futura, y reintentarla solo repite el fallo.

`ejecutarFlujo` con un `runId` existente **reanuda en vez de crear**, que es exactamente lo que hace falta: la fila ya existe porque la insertó la web.

`SKIP LOCKED` es lo que permite que mañana haya dos workers sin que se pisen. No hace falta hoy y no cuesta nada tenerlo.

### Toda la lógica fuera del bucle

`tomarYEjecutarUna()` toma la base y las dependencias, hace una unidad de trabajo y devuelve qué hizo. El bucle es un `setInterval` que la llama. Esa frontera existe para que lo interesante se pruebe sin levantar un proceso: es el primer componente de este repositorio que corre indefinidamente, y un bucle colgado no lo detecta ninguna prueba.

### Cómo se levanta

Servicio de `docker compose`, junto a Postgres. `docker compose up -d` —el comando que ya está en la cabeza y en `CLAUDE.md`— levanta los dos.

El código se monta como volumen y se ejecuta con `tsx`, no se copia a la imagen: sin eso, cada cambio exigiría reconstruirla, que es exactamente la fricción que este bloque viene a quitar.

**La alternativa considerada y descartada:** un `pnpm dev` en la raíz que arranque la web y el worker juntos. No necesita `Dockerfile`, pero deja una terminal abierta, y la queja que originó este bloque era justamente esa.

---

## 5. Las pantallas

### Lo que gana cada una

| Pantalla | Qué gana |
|---|---|
| `/` | Botón de crear marca: slug, nombre, presupuesto. Escritura simple, sin worker |
| `/[marca]/perfil` | Deja de romperse cuando la marca no tiene perfil todavía |
| `/[marca]/estrategia` | "Generar estrategia de `2026-Q4`" donde hoy está el comando del CLI |
| `/[marca]/grilla/[mes]` | "Generar grilla" donde hoy está el comando del CLI |

**El hueco del perfil es real y hay que taparlo:** `perfilConHistorial` lanza `permanente` si la marca no tiene ninguno. Hoy es inalcanzable porque toda marca nace del CLI con su perfil detrás; en cuanto la web pueda crear marcas, la primera visita a esa pantalla revienta. Pasa a mostrar el editor vacío con una plantilla de partida.

### Cómo la pantalla encuentra su corrida

`pipeline_runs.input` ya lleva `{ brandId, mes }` o `{ brandId, period }`. La pantalla busca la corrida más reciente de esa marca, ese flujo y ese periodo, y decide por su estado:

| Estado | Qué ve el usuario |
|---|---|
| `pendiente`, menos de 30 s | "En cola" |
| `pendiente`, más de 30 s | "Nadie tomó esta generación. ¿Está corriendo el worker?", nombrando el comando |
| `en_curso` | "Generando…", con el paso en que va |

El paso en curso sale de `pipeline_steps`: la fila más reciente de esa corrida, por `started_at`. Los nombres son de máquina (`proponer_grilla`, `persistir_grilla`), así que la pantalla los traduce con un mapa a algo legible — "Proponiendo la grilla", "Guardando". Un nombre de paso que no esté en el mapa se muestra tal cual en vez de romper: un paso nuevo en el motor no debe tumbar una pantalla.
| `fallido` | El error tal cual, y **Reanudar** |
| `completado` | El resultado: la grilla o la estrategia |

La antigüedad es la que detecta el modo de falla nuevo que este bloque introduce: si nadie está consumiendo la cola, la pantalla diría "generando" para siempre. Medirla no cuesta ninguna tabla ni ningún latido.

### Un solo botón para dos fallas

**Reanudar no distingue "falló" de "se colgó".** Si el worker muere a mitad de una corrida, la fila queda en `en_curso` para siempre; si un paso agota sus reintentos, queda `fallido`. Como el pipeline es idempotente por paso, en ambos casos la operación correcta es la misma y los pasos ya pagados no se reejecutan.

### El refresco

Mientras hay una corrida viva, un componente de cliente llama a `router.refresh()` cada dos segundos. **Se detiene cuando la corrida termina.** Un temporizador que no para es la clase de cosa que se descubre semanas después preguntándose por qué el ventilador no se apaga.

### Las cuatro Server Actions

`crearMarcaAccion`, `encolarEstrategiaAccion`, `encolarGrillaAccion`, `reanudarCorridaAccion`. Las cuatro son escrituras cortas y **ninguna llama al modelo**, así que la regla estructural sigue en pie sin excepciones.

`pnpm comprobar:aislamiento` la sigue exigiendo, ahora con `apps/worker` como nodo nuevo del grafo: el worker sí depende de `@gc/flujos`, y hay que verificar que eso no lo meta en el cierre de dependencias de `apps/web`.

---

## 6. Lo que hay que advertir en pantalla

**Regenerar un mes reemplaza sus slots.** Si ya descartaste publicaciones, esos descartes se pierden.

Hoy es inalcanzable porque nadie regenera desde la web. En cuanto exista el botón, es un clic, y lo que se pierde es trabajo humano de revisión. La confirmación tiene que decirlo con esas palabras, como la de aprobar dice lo suyo.

El motor no puede distinguir "regenera de cero" de "regenera respetando lo que descarté". Eso último sería una función distinta y este bloque no la construye.

---

## 7. Los insumos de Fase 1 que este bloque destapa

`pendientes.md` guarda cuatro. Tres dejan de ser deuda porque este bloque es su primer consumidor.

### 1. Reanudar deja de ser una bandera que nadie expone

El motor ya lo soporta y está probado; el CLI nunca pasó `runId`. Aquí se vuelve un botón, y de paso el CLI gana la bandera: son dos superficies del mismo motor y dejar una sin la capacidad es cómo nacen las divergencias.

### 2. La salida entre pasos no está versionada

`pendientes.md` lo dice literalmente: *"conviene versionar la salida antes de exponer el botón de reanudar"*. Una corrida cuyo primer paso se completó con una versión anterior del código tiene una salida de forma incompatible, y el segundo paso la desestructura a `undefined`.

Falla ruidosamente, no en silencio — pero con el botón expuesto se vuelve alcanzable, y el mensaje que recibe el usuario no dice nada útil.

**La forma concreta:** la salida que un paso guarda en `pipeline_steps.output` pasa a llevar un campo `version` entero junto a sus datos. El motor no lo interpreta —sigue tratando la salida como jsonb opaco— pero cada paso declara qué versión produce y cuál acepta, y al reanudar rechaza con `permanente` una salida cuya versión no reconoce, nombrando el remedio: generar de nuevo en vez de reanudar.

El número se sube a mano cuando la forma cambia. Es un contador humano, no un hash: un hash rechazaría por cambios cosméticos y entrenaría a la gente a ignorarlo.

### 3. Nada filtra por `descartado` en el camino de generación

`SalidaP2.totalSlots` los cuenta, y `expandirDerivados` y `validarGrilla` no miran el estado. Regenerar recontaría los slots descartados en las reglas de cadencia y de distribución de pilares.

Hoy no se alcanza porque nadie regenera un mes que ya tuvo descartes. Con el botón, sí.

### 4. Tres nombres para el mismo concepto

`brandSlug`, `nombreVisible` y `slug` para lo mismo, más `ReferenciaResuelta` y `ReferenciaDeMarca` idénticas por accidente. Limpieza barata, y el worker sería el cuarto sitio que elige un nombre.

---

## 8. Pruebas

Lo que de verdad hay que afirmar y hoy nadie afirma:

- **Que dos workers no tomen la misma corrida.** Dos transacciones concurrentes contra Postgres real, y que solo una vuelva con fila. Es lo que `SKIP LOCKED` promete y lo que se rompe al tocarlo.
- **Que la web no ejecute en la petición.** La acción devuelve con la fila en `pendiente` y sin ninguna llamada registrada en `ai_calls`.
- **Que reanudar no reejecute los pasos completados**, medido en `ai_calls` y no en el resultado: el resultado sale igual de las dos formas, así que medirlo ahí no distingue nada.
- **Que una salida de versión incompatible se rechace al reanudar**, con el mensaje que nombra el remedio.
- **Que regenerar no recuente los descartados** en cadencia ni en distribución.
- Las pantallas nuevas, con el arnés de componentes que la rama anterior montó, y con las Server Actions sustituidas.

Y la disciplina que este proyecto ya pagó por aprender: **cada prueba se rompe a propósito antes de darse por buena**. En la rama anterior aparecieron cuatro cuyo nombre prometía una mitad que ninguna aserción respaldaba, todas verdes.

---

## 9. Riesgos

**El worker es lo primero de este repositorio que corre indefinidamente.** Todo lo demás empieza y termina. Un bucle que se cuelga en silencio, o que se come la CPU reintentando, no lo detecta ninguna prueba. La mitigación es estructural: el bucle es trivial y todo lo interesante vive en `tomarYEjecutarUna()`, que se prueba sin bucle.

**La regeneración con descartes destruye trabajo humano.** Es el riesgo de datos del bloque y la confirmación es su única defensa.

**Esto es la mitad de 1C sin darse cuenta.** El worker que se escriba aquí es el que va a Cloud Run, así que no puede depender de nada que solo exista en esta máquina: ni rutas absolutas, ni suponer que Postgres está en `localhost`, ni resolver el `.env` de la raíz por `import.meta.url`. Ese último punto ya mordió una vez en esta base de código, cuando el mismo patrón no sobrevivió a jsdom.

**El `Dockerfile` del worker es andamiaje nuevo que hay que mantener.** Es el costo aceptado de que `docker compose up -d` sea el único comando. Si resulta más frágil de lo previsto —reconstrucciones lentas, permisos de volumen en Windows— la salida es el `pnpm dev` de la §4, que llega al mismo lugar funcional con una terminal abierta.

---

## 10. Siguiente paso

Plan de implementación. El bloque 1C —despliegue, Cloud SQL, autenticación— conserva su propio ciclo de spec, plan e implementación, y hereda de aquí el worker ya escrito.
