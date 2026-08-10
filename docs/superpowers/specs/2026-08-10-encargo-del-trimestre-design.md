# La estrategia deja de adivinar qué quieres lograr

**Fecha:** 2026-08-10
**Estado:** diseño aprobado, pendiente de plan
**Rama:** `feat/encargo-del-trimestre`

## Por qué existe este bloque

Hoy `encolarEstrategia` recibe dos cosas: la marca y el periodo. Nada más. P1 carga el perfil de marca vigente, lee un instructivo fijo, y le dice al modelo «genera la estrategia de contenido para el periodo 2026-Q3».

O sea que el sistema conoce la **identidad** de la marca y no tiene forma de saber qué quieres lograr **este trimestre**. Y eso es justo lo que un plan trimestral debería responder: del mismo perfil de `tapcar` deberían salir estrategias distintas según si estos tres meses quieres vender rápido o construir marca.

Se nota en dos campos concretos del esquema de salida:

- **`objetivos[].metrica`** sale con métricas inventadas, porque nadie le dijo cuáles puedes medir de verdad.
- **`mixDeCanales[].publicacionesPorSemana`** se lo inventa entero. El propio instructivo le pide «prefiere una cadencia baja y constante antes que una alta e irreal», sin decirle cuál es tu baja ni en qué canales puedes publicar.

El resultado es plausible y genérico. La estrategia es la entrada de la grilla mensual, así que ese genérico se propaga a todo el contenido del trimestre.

## Lo que NO cambia

- **El esquema `Estrategia`** y su validación. La salida sigue teniendo la misma forma.
- **P2 y la grilla mensual.** La grilla lee la estrategia, y la estrategia ya absorbió el encargo. Darle también el encargo sería darle dos fuentes para lo mismo.
- **El perfil de marca**, su editor y su versionado.
- **El motor, la cola y el worker.**
- **La regla de que la capa web nunca llama al modelo.** Es la que descarta un cuestionario conversacional (ver §Alternativas descartadas).

## El encargo

Nueve campos, en cuatro bloques. Cuatro obligatorios y cinco no: **«obligatorio» describe que el encargo exista, no que los nueve campos estén llenos.**

| Bloque | Campo | ¿Obligatorio? | Qué alimenta |
|---|---|---|---|
| Lo que quieres lograr | `objetivo` | sí | `objetivos[].nombre`, `mensajesClave` |
| | `comoSeMide` | sí | `objetivos[].metrica` y `.meta` |
| Lo que puedes sostener | `publicacionesPorSemana` | sí | el total del `mixDeCanales` |
| | `canalesDisponibles` | sí | qué canales puede usar el mix |
| El momento | `queEstaPasando` | no | `temasPrioritarios` |
| | `queFunciono` | no | `temasPrioritarios`, `mixDeCanales` |
| | `queNoFunciono` | no | qué evitar repetir |
| Los límites | `queEvitar` | no | temas fuera del trimestre |
| | `algoMas` | no | lo que el formulario no previó |

`canalesDisponibles` se elige de `CANALES` (`instagram`, `linkedin`, `facebook`, `tiktok`, `blog`), la misma lista que el esquema de la estrategia acepta. `publicacionesPorSemana` es un entero.

**`queEvitar` no duplica el léxico prohibido del perfil.** Ese es lo que la marca *nunca* dice, y es parte de su identidad. Este es lo que *este trimestre* no toca, y caduca con él.

### Lo que el encargo pide y no exige

Que la estrategia respete la capacidad declarada se lo **pide el prompt**; no lo hace cumplir ninguna validación.

Es deliberado. Una regla que rechace una estrategia cuyo mix supere el número declarado sería una segunda lista de reglas sincronizada a mano con el esquema, y `pendientes.md` ya registra dos deudas exactamente de esa forma —los filtros de `derivados.ts` contra las reglas bloqueantes de `validacion.ts`, y las reglas del prompt del perfil contra `packages/brand/src/perfil.ts`—. Una tercera copia no se paga con lo que compra.

El modo de falla es benigno y visible: la estrategia se muestra entera antes de aprobarla, y el mix aparece canal por canal con su número. Si el modelo lo ignora, se ve al leerlo.

## Dónde vive

**Tabla nueva `strategy_briefs`**, una fila por marca y periodo:

- `id`, `organization_id` (con cascada a `organizations`), `brand_id`, `period`, `data` (`jsonb`), `created_at`, `created_by`.
- Única `(brand_id, period)`.
- Única `(id, organization_id)` y clave foránea compuesta `(brand_id, organization_id)` → `brands`, como las doce que ya existen: la tenencia se verifica dentro de la escritura, no confiando en una lectura previa.
- Migración `0007`, **sin** el envoltorio `DO $$ ... EXCEPTION`. Una migración que se salta sola es peor que una que falla.

**El esquema Zod vive en `@gc/strategy`**, junto a `Estrategia`. Esto importa más de lo que parece: `apps/web` **sí** declara `@gc/strategy` —está en su cierre de dependencias, a diferencia de `@gc/brand`—, así que el formulario y el flujo comparten una sola declaración. No se repite la deuda del editor de perfil, donde las reglas quedaron copiadas a mano en dos lugares porque el paquete era inalcanzable.

### Editar, regenerar y congelar

El encargo se corrige mientras **no haya estrategia todavía, o la que haya siga en borrador**, y regenerar la rehace con lo nuevo. En cuanto la estrategia sale de borrador —a `aprobada` o a `archivada`—, el encargo queda de solo lectura, congelado con ella. La condición es «el estado no es borrador», no «el estado es aprobada»: una estrategia archivada tampoco se regenera, así que su encargo tampoco tiene por qué cambiar.

Es la misma regla que `strategies` ya aplica en su `onConflictDoUpdate` con `setWhere: status = 'borrador'`, y evita una mentira concreta: leer un encargo que ya no es el que produjo la estrategia que estás mirando.

### Dónde se hace cumplir lo obligatorio

En **`encolarEstrategia`**, no en la pantalla. Sin encargo para ese periodo, encolar falla con un error `permanente` que nombra el remedio.

Deshabilitar el botón es comodidad. La barrera va en la operación porque una Server Action es un endpoint HTTP con identificador estable: cualquiera que lo conozca puede llamarla sin pasar por la página, y esa lección ya está escrita en `CLAUDE.md`.

## Cómo llega al modelo

P1 carga el encargo junto al perfil vigente y lo agrega al mensaje del usuario como una **sección propia**, separada de `contextoDeMarca`: la identidad por un lado, el encargo del trimestre por otro. Un encargo mezclado con el perfil invita al modelo a tratar como permanente algo que dura tres meses.

El instructivo del sistema (`prompts/generar-estrategia.md`) gana dos reglas:

- el mix de canales no puede superar el total de publicaciones por semana declarado, ni usar canales fuera de los declarados;
- los objetivos usan la métrica que el encargo declara medible, en vez de proponer otras.

Ninguna de las dos es validación: son instrucciones, y viven donde viven las demás.

## La pantalla

El encargo vive en la **misma página de estrategia**, en un bloque propio arriba de todo. La página ya distingue tres estados —ausente, inválida, válida—; el encargo agrega una pregunta anterior a las tres: ¿existe para este trimestre?

- **Sin encargo:** el bloque está abierto y es lo único accionable. El texto del estado vacío dice que primero hay que escribir el encargo, y el botón de generar no aparece.
- **Con encargo:** el bloque queda plegado, mostrando el objetivo en una línea. Se abre para corregirlo. El botón de generar vuelve a donde está hoy.
- **Con la estrategia fuera de borrador:** el bloque queda de solo lectura, y dice por qué.

El formulario es su propio componente de cliente, como `EditorDePerfil`; la página sigue siendo un Server Component que solo lo renderiza, y reutiliza las primitivas de campo que ya existen en `apps/web/src/componentes/perfil/`.

Va en la misma página y no en una ruta aparte porque el encargo y la estrategia se leen juntos: estás evaluando si la estrategia responde a lo que pediste. Mandar a otra pantalla para cambiar la entrada que estás juzgando es fricción sin ganancia — y una ruta nueva necesitaría su propio `export const dynamic = 'force-dynamic'`, que es exactamente la clase de detalle que se olvida y no falla hasta producción.

## El CLI

`estrategia:generar` sigue existiendo y funciona cuando el encargo ya está escrito. Sin él falla con el mismo error `permanente` de `encolarEstrategia`, que nombra la pantalla donde escribirlo.

No se le construye una carga por archivo. El dueño confirmó que la web es su único camino para esto, y un segundo formato de entrada exigiría su propia validación, su propia prueba y su propio modo de quedar desactualizado.

## Cómo se verifica

Cinco capas. Las dos últimas son las que prueban que el bloque sirvió.

1. **El esquema**, en `@gc/strategy`, sin renderizar nada: qué exige, qué rechaza, qué acepta vacío.
2. **`encolarEstrategia` se niega sin encargo**, en `@gc/operaciones`. Es la barrera real, la que no depende de que el botón esté deshabilitado.
3. **El encargo llega al mensaje del modelo**, en `p1.test.ts`, con el cliente falso que ya captura los mensajes. Que el texto escrito aparezca en el prompt es afirmable; que el modelo lo obedezca, no — y esa distinción es la razón de que la capacidad se pida y no se exija.
4. **El formulario en el navegador**, llenado de principio a fin para una marca real. Si escribir nueve campos no se siente mejor que no tener dónde decirlo, el bloque falló aunque todo esté verde.
5. **La que ninguna reemplaza:** generar la estrategia con el encargo puesto y compararla con la que sale sin él. **Si son parecidas, el prompt no está usando lo que se escribió**, y lo que hay que arreglar es el instructivo, no el código.

Advertencia que este repositorio se ganó: **una prueba de componente puede afirmar contra el documento entero y parecer que verifica el lugar correcto.** Ya ocurrió cuatro veces, y el bloque anterior encontró seis más. Cada prueba se valida rompiendo el código a propósito y exigiendo que se ponga roja por la razón exacta.

## Riesgos

**Que el modelo ignore el encargo y la estrategia salga igual de genérica.** Es el riesgo central y no se resuelve con código: se mide en la verificación 5. Si ocurre, lo que falta son instrucciones más explícitas en el prompt, o el encargo en un lugar más prominente del mensaje.

**Que nueve campos se sientan un trámite.** Cuatro son obligatorios y cinco no, precisamente para que el camino corto exista. Si aun así pesa, la salida no es quitar preguntas sino la que se aplazó abajo: dejar que una IA externa las redacte y tú las revises.

**Que el encargo congelado estorbe.** Una estrategia aprobada congela su encargo, así que corregir una errata exige devolver la estrategia a borrador. Es el precio de que lo que se lee sea lo que produjo lo que se ve, y es el mismo precio que el sistema ya cobra en la estrategia misma.

## Alternativas descartadas

**Una nota de texto libre por trimestre.** Mucho menos código, y borra el valor entero del bloque: una caja vacía no dice qué esperaba que le contaras, así que es fácil olvidar la capacidad de publicación o lo que fracasó el trimestre pasado — que son justo los dos huecos que motivaron esto.

**Preguntas que la IA arma para cada marca.** Adaptativo y lento: como la web no puede llamar al modelo, habría que apretar «preparar preguntas», esperar a que el worker despierte, y volver. Dos llamadas pagadas y dos modos de falla nuevos para llegar al mismo sitio que un cuestionario fijo, porque las preguntas que importan —qué quieres lograr, cuánto puedes publicar, qué está pasando— son las mismas para cualquier marca.

**Heredar el encargo del trimestre anterior.** Evaluado y descartado por el dueño: el ahorro de escritura invita a aprobar sin leer, y una estrategia apuntando al objetivo del trimestre pasado es peor que dos minutos de escritura.

## Fuera de alcance

- **El botón «copiar prompt para IA»** dentro del encargo, como el que tiene el perfil. Aplazado a propósito: el patrón ya está probado y agregarlo después es mecánico, pero si las preguntas están mal redactadas el prompt solo multiplica el problema. Primero hay que ver si el formulario solo se siente bien.
- **Que el encargo alimente también a P2.**
- **Validar que la estrategia respete la capacidad declarada.** Tratado arriba.
- **Carga del encargo por archivo desde el CLI.**
- **Las demás pantallas.**
