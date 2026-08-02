# Deuda de insumos para 1B y 1C — Diseño

**Fecha:** 2026-08-01
**Estado:** Aprobado para planificación
**Origen:** los cinco puntos de "Prioridad 1 — insumos para el diseño de los bloques 1B y 1C" de [pendientes.md](pendientes.md), levantados por la revisión adversarial de `feat/app-web-1a`
**Alcance:** `@gc/strategy`, `@gc/operaciones`, `apps/web`, `apps/cli`, y un paquete nuevo. Sin migraciones.

---

## 1. Por qué antes de 1B y 1C

Los cinco puntos son insumos de diseño, no defectos que rompan algo hoy. Se cierran ahora por la misma razón que se cerró la Prioridad 1 antes de la Fase 1: **cada uno es más barato antes de que otro bloque construya encima**.

Dos de ellos lo son de forma concreta. El lector de estrategia está triplicado y 1B suma un cuarto consumidor —el worker— que lo copiaría otra vez. Y el aislamiento entre la web y el modelo se sostiene hoy en una convención; 1B introduce precisamente el proceso que sí debe llamar al modelo, que es cuando una convención se rompe sin que nadie lo note.

**No es objetivo** adelantar trabajo de 1B ni de 1C, ni tocar la Prioridad 2.

---

## 2. Decisiones tomadas

| Decisión | Elección | Razón |
|---|---|---|
| Aislar la web del modelo | **Separar `@gc/flujos` como paquete** | La garantía la da el resolvedor de pnpm, no una prueba ni una convención |
| Unificar el lector de estrategia | **Uno solo, con la política de archivadas como parámetro** | Ver §4 |
| Pruebas de renderizado | **Arnés de componentes de cliente, sin navegador** | Cubre las cinco garantías listadas sin montar el subsistema que 1A descartó |
| Auto-creación de la organización | **Solo el CLI puede crearla** | Un `GET` no debe escribir |

---

## 3. Parte 1 — La separación de paquetes

### El problema

`pendientes.md` lo dice sin adornos: la regla "la web nunca llama al modelo" **es una línea en un `package.json`, no una garantía**. Hoy la cadena existe y funciona:

```
apps/web → @gc/operaciones (barril) → flujos.ts → @gc/strategy (barril) → @gc/ai
```

Y hay una segunda cadena que las subrutas de exportación por sí solas no cortan: `grilla.ts` importa `validarGrilla` del barril de `@gc/strategy`, que reexporta `p1` y `p2`, que arrastran `@gc/ai` igual.

### El enfoque descartado

Subrutas de exportación en ambos paquetes (`@gc/operaciones/flujos`, `@gc/strategy/validacion`). Es el patrón que esta misma rama ya usó para `@gc/strategy/periodos`, es más barato, y **deja `@gc/ai` resoluble desde la web**. Corrige el grafo de hoy sin impedir el de mañana: nada frena a quien escriba el import el mes que viene.

La variante con una prueba que recorra los imports de `apps/web/src` sí lo exige, pero a cambio de herramienta propia que hay que mantener y que puede quedar desincronizada del bundler real.

### El enfoque elegido

El corte resulta limpio porque solo tres archivos de `@gc/strategy` tocan el modelo:

| Paquete nuevo `@gc/flujos` | Viene de |
|---|---|
| `p1.ts`, `p2.ts`, `tipos.ts`, `prompts/` y sus pruebas | `@gc/strategy` |
| `flujos.ts` y su prueba | `@gc/operaciones` |

Y los dos paquetes que quedan atrás **borran `@gc/ai` y `@gc/pipeline` de sus manifiestos**:

| Paquete | Contiene | Ya no depende de |
|---|---|---|
| `@gc/strategy` | `derivados`, `esquemas`, `periodos`, `validacion`, `estrategias` (§4) | `@gc/ai`, `@gc/pipeline` |
| `@gc/operaciones` | `marcas`, `perfiles`, `grilla` | `@gc/ai`, `@gc/pipeline` |
| `@gc/flujos` | `p1`, `p2`, `tipos`, `flujos` | — |

Con el `node_modules` aislado de pnpm, `apps/web` deja de poder resolver `@gc/ai` aunque alguien escriba el import a mano. Es un error de resolución, no una revisión de código que puede pasarse.

### Direcciones y ciclos

`@gc/flujos` depende de `@gc/operaciones` porque `flujos.ts` necesita `resolverMarca`. No hay ciclo: `@gc/operaciones` deja de reexportar `flujos` desde su barril, que es justamente el cambio que lo hace posible.

`apps/cli` pasa a declarar `@gc/flujos`. Es su único consumidor hoy; el worker de 1B será el segundo.

### Lo que no cambia

`@gc/strategy` conserva su subruta `./periodos`. Aunque el barril ya no arrastre el modelo, sigue arrastrando `drizzle-orm` y `@gc/db` por `estrategias.ts`, y `calendario.ts` se importa desde un componente de cliente. La razón documentada en ese archivo sigue siendo válida, con distinto motivo: el bundle del navegador, no `@gc/ai`.

---

## 4. Parte 2 — El lector de estrategia unificado

### El problema

Tres funciones leen la estrategia de un trimestre y difieren en cuatro ejes a la vez:

| | Archivadas | Devuelve | Identifica la marca | Valida |
|---|---|---|---|---|
| `cargarEstrategiaVigente` (`p2.ts`) | excluye | lanza `permanente` | `brandId` | sí |
| `cargarEstrategiaDelTrimestre` (`grilla.ts`) | excluye | unión `ok`/`ausente`/`inválida` | `brandId` | sí |
| `estrategiaDelTrimestre` (`perfiles.ts`) | **incluye** | `null` | `slug` | **no** |

Los nombres no delatan ninguna de esas diferencias. `grilla.ts` lleva hoy un comentario de doce líneas cuyo único propósito es advertir que no se confunda con la de `perfiles.ts` — señal de que el problema es de estructura y no de documentación.

**Un defecto no registrado que esto destapa:** `estrategiaDelTrimestre` devuelve `fila.data` sin validar, y la página de estrategia lo parsea por su cuenta. Una estrategia corrupta se comporta distinto según por dónde se entre: en la grilla sale como problema bloqueante con su remedio, en la vista de estrategia sale como lo que decida la página.

### El enfoque descartado

Ponerlo en `@gc/operaciones`, donde viven dos de los tres consumidores. No sirve: `p2.ts` está más abajo en el grafo y no podría usarlo. Unificaría dos de tres y dejaría la tercera copia justo en el camino que paga el modelo — la trampa del punto, invertida.

### El enfoque elegido

Un lector en `@gc/strategy/estrategias.ts`, alcanzable por los tres:

```ts
export type PoliticaDeArchivadas = 'excluir' | 'incluir'

/** `ESTADOS_STRATEGY` de `@gc/db`, que es el enumerado que la tabla exige por CHECK. */
type Estado = (typeof ESTADOS_STRATEGY)[number]

export type LecturaDeEstrategia =
  | { tipo: 'ok';       periodo: string; id: string; estado: Estado; estrategia: TipoEstrategia }
  | { tipo: 'ausente';  periodo: string }
  | { tipo: 'invalida'; periodo: string; id: string; estado: Estado }

export async function leerEstrategiaDelTrimestre(
  db: BaseDeDatos,
  brandId: string,
  mes: string,
  opciones: { archivadas: PoliticaDeArchivadas },
): Promise<LecturaDeEstrategia>
```

Una consulta, una validación, la política **explícita en cada sitio de llamada**. Es la forma de la unión que `grilla.ts` ya había inventado, promovida al lugar donde sirve a los tres.

Los consumidores quedan como adaptadores:

- **`p2.ts`** — `cargarEstrategiaVigente` se vuelve un envoltorio que traduce `ausente` e `invalida` a los `permanente` que ya lanza, con los mismos textos. Su comportamiento observable no cambia.
- **`grilla.ts`** — borra su copia privada y el comentario `⚠️` que existía para advertir de esta confusión.
- **`perfiles.ts`** — `estrategiaDelTrimestre` conserva nombre y firma por slug, resuelve la marca y delega con `archivadas: 'incluir'`. Pasa a devolver la unión en vez de `| null`, y la página de estrategia trata `invalida` explícitamente en vez de parsear por su cuenta.

El estado se devuelve siempre, incluso en `invalida`, porque la vista de solo lectura lo muestra tal cual y esa es su razón de incluir archivadas.

---

## 5. Parte 3 — Reabrir desde la web

`reabrirGrilla` ya existe en `@gc/operaciones`, ya está probada, y ya solo acepta pasar de `aprobada` a `borrador`. Falta exponerla: una Server Action más un botón en la cabecera, visible únicamente cuando el estado es `aprobada`, con confirmación.

Es el trabajo más pequeño de esta rama y cierra un callejón real: hoy aprobar deja el mes inmutable y volver atrás exige terminal.

---

## 6. Parte 4 — El arnés de componentes

### Qué cubre y qué no

`pendientes.md` enumera cinco garantías que nadie afirma y que fallarían en silencio. Las cinco son de componentes de cliente, así que las cinco quedan cubiertas sin navegador:

| Garantía | Componente |
|---|---|
| Las fichas descartadas se leen como descartadas | `FichaDeSlot` |
| Cada slot cae en una celda | `RejillaDelMes` |
| "Reintentar" repite la operación que falló | `PanelDeDetalle`, `EditorDePerfil` |
| El foco entra al diálogo y vuelve al disparador | `PanelDeDetalle` |
| El número de versión del perfil es el recién guardado | `EditorDePerfil` |

Fuera de alcance siguen las páginas async de servidor, que exigen el navegador real que el diseño de 1A descartó por ser un subsistema aparte. Esa decisión no se revisa aquí.

### Cómo

`jsdom` con `@testing-library/react`, más `@vitejs/plugin-react` para el JSX. La directiva `// @vitest-environment jsdom` va **por archivo**, en vez de partir la configuración: `datos.test.ts` y `calendario.test.ts` golpean Postgres y deben seguir en `node`.

`apps/web/vitest.config.ts` ya incluye `.tsx` en su patrón, con un comentario que explica que sin eso la primera prueba de componente se saltaría en silencio. Ese trabajo ya está hecho.

**La pieza de diseño que importa: las Server Actions se sustituyen con `vi.mock`.** La prueba afirma qué llama el componente y qué muestra, no qué escribe la base — eso ya está cubierto en `@gc/operaciones` contra Postgres real. Sin la sustitución, cada prueba de componente arrastraría la base y el `'use server'`, y mediría dos cosas a la vez.

### La advertencia

Nada afirma hoy que esas cinco garantías se cumplan. Es probable que alguna prueba nazca roja —el foco del diálogo es la candidata— y **arreglar lo que destape entra en el alcance**. Descubrir que una garantía no se cumplía es el resultado esperado de escribir la primera prueba que la afirma, no un desvío.

Aplica la regla del proyecto sin excepción: cada prueba nueva se rompe a propósito y se confirma que se pone roja.

---

## 7. Parte 5 — La deuda menor

Seis ítems que `pendientes.md` dejó en una línea cada uno.

### La versión que muestra el editor de perfil

`EditorDePerfil` muestra "Perfil guardado como versión N" leyendo `version` de sus props, que se actualiza recién cuando la revalidación del servidor vuelve. Entre que la acción responde y eso ocurre, el mensaje afirma un número que puede ser el anterior.

`guardarPerfilAction` pasa a devolver la versión nueva, y `Resultado` pasa a poder llevar datos:

```ts
export type Resultado<T = null> =
  | { ok: true; datos: T }
  | { ok: false; mensaje: string; reintentable: boolean }
```

El valor por defecto es `null` y no `void` a propósito: con `void` la propiedad seguiría siendo obligatoria y las cuatro acciones existentes tendrían que declararla igual. Con `null`, el ayudante `ejecutar` pasa a devolver lo que devuelva su callback —`null` cuando no devuelve nada— y las cuatro acciones que solo hacen `return ejecutar(...)` no se tocan.

Es el mismo cambio que hace verdadera la quinta garantía de §6, así que van juntos.

### La organización resuelta dos veces por petición

`layout.tsx` y `page.tsx` llaman `organizacionPorDefecto` por separado. `React.cache()` la deduplica dentro de la petición. Es la solución estándar y no introduce estado global.

### Un `GET` puede crear la organización

`resolverOrganizacion` inserta cuando no existe ninguna. La web la llama en cada petición, así que un `GET /` escribe en la base — y por la rama que la Prioridad 2 ya registró como insegura ante concurrencia.

Recibe un parámetro que decide si puede crear. **El CLI sí, la web no.** En un clon nuevo la web falla con un mensaje que nombra el comando de siembra, en vez de sembrar sola desde una lectura.

La rama de creación no se vuelve segura ante concurrencia en esta rama: sigue siendo un ítem de Prioridad 2, y con la web fuera de ese camino solo queda alcanzable desde el CLI, donde no hay concurrencia.

### Slots fuera de la rejilla

Un slot cuya fecha no cae en ninguna semana renderizada no se muestra, pero sí cuenta en `porCanal` y en los problemas. Queda algo contado e invisible, que es la peor combinación.

Una función pura y probada en `calendario.ts` —`slotsFueraDeLaRejilla(slots, semanas)`— y la rejilla los muestra en un grupo al final. Sigue el principio que `pendientes.md` fijó: la derivación vive en una función probada, no adentro del componente.

### Sin cota de longitud

`SlotPropuesto.angulo` y `.brief` tienen `.min()` y no `.max()`. Se agrega `.max(200)` al ángulo y `.max(2000)` al brief, con mensajes en español como los mínimos que ya llevan — son los dos únicos campos que la web deja editar a mano, y ese texto se le muestra al usuario tal cual.

Los números salen de para qué sirve cada campo: el ángulo es una frase y el brief es un párrafo de encargo. Ambos quedan muy por encima de lo que produce el modelo hoy, así que la cota atrapa pegados accidentales y no rechaza generación legítima. Aplica a los dos caminos, que es lo correcto: la cota es del dominio, no del formulario.

### El manifiesto de `apps/web`

Se resuelve casi solo con §3: `@gc/ai` y `@gc/pipeline` salen de `transpilePackages` porque dejan de ser alcanzables. `@gc/brand` se quita de las dependencias si `typecheck` lo permite; si algún tipo lo requiere de forma transitiva, se deja y se documenta por qué.

---

## 8. Pruebas

Cada parte con la prueba que la haría fallar si se revierte:

- **Separación de paquetes:** la suite completa verde es la prueba. Más una comprobación explícita de que `@gc/ai` no aparece en el cierre transitivo de dependencias de `apps/web` (`pnpm why`).
- **Lector unificado:** que `'excluir'` no devuelva una archivada y `'incluir'` sí; que una estrategia corrupta salga como `invalida` **por los tres caminos**, que es el defecto que se está cerrando; que el mensaje de P2 siga nombrando el periodo faltante.
- **Reabrir desde la web:** la operación ya está probada; la acción se prueba como las otras cuatro.
- **Arnés:** las cinco garantías de §6, cada una rota a propósito antes de darse por buena.
- **Deuda menor:** que `guardarPerfilAction` devuelva la versión que efectivamente quedó; que `slotsFueraDeLaRejilla` encuentre un slot fuera del mes; que `.max()` rechace; que `resolverOrganizacion` sin permiso de creación falle en vez de insertar, y que con permiso siga creando.

Las tres comprobaciones obligatorias del proyecto valen igual: `pnpm test`, `pnpm -r typecheck`, y `pnpm --filter @gc/web build` confirmando que las rutas sigan saliendo con `ƒ` y no con `○`.

---

## 9. Riesgos

**La separación de paquetes es el riesgo real de esta rama.** Mueve 93 pruebas de `@gc/strategy` a dos paquetes y toca los imports de `apps/cli`. Es mecánico —como lo fue promover `packages/operaciones` en 1A— pero es el punto donde algo que ya funcionaba se rompe. Va como primera tarea, con la suite completa como red.

**El script de pruebas de la raíz absorbe el paquete nuevo sin cambios**, porque es `pnpm -r --workspace-concurrency=1 test`. Igual hay que confirmar que el paquete nuevo aparezca en la salida: un paquete sin script `test` se salta en silencio y el total bajaría sin que nadie lo note.

**El arnés de componentes suma dependencias de desarrollo a `apps/web`.** Son cuatro y todas estándar, pero es la primera vez que este repositorio monta un entorno que no es `node`. Si `jsdom` pelea con algo, el arnés se acota a los componentes que sí corran y se registra cuál quedó fuera — nunca se da por cubierta una garantía que no se afirmó.

**`CLAUDE.md` queda desactualizado por esta rama.** Su bloque de arquitectura dice que `@gc/strategy` contiene los flujos P1 y P2. Se actualiza en el mismo commit que los mueve, no después.

---

## 10. Siguiente paso

Plan de implementación. Los bloques 1B y 1C conservan su propio ciclo de spec, plan e implementación, y arrancan con estos cinco insumos ya cerrados.
