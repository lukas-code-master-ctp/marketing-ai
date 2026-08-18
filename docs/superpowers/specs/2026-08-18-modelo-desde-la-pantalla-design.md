# El modelo se elige desde la pantalla

**Fecha:** 2026-08-18
**Estado:** diseño aprobado, pendiente de plan
**Rama:** `feat/modelo-desde-la-pantalla`
**Bloque:** de configuración, entre 2A y 2B

## Por qué existe este bloque

Cambiar de modelo hoy es editar el `.env` en local y correr un `gcloud run services update` a mano en producción — porque el despliegue automático pasa **solo la imagen**, a propósito, para no pisar el token compartido ni la contraseña de la base. Nadie que no sepa eso puede cambiarlo, y quien lo sabe tiene que acordarse de hacerlo en dos lugares.

El costo real no es la molestia: es que **elegir modelo es una decisión de producto, no de infraestructura.** Cuál escribe mejor los posts de LinkedIn se descubre leyendo lo que produce, y esa lectura la hace el dueño en el navegador — a dos comandos de distancia de poder actuar sobre lo que acaba de leer.

Este bloque mueve esa decisión a una pantalla, con un menú corto de candidatos curados en vez del catálogo entero de OpenRouter.

**Cierra además, por construcción, el pendiente de `MODELO_REDACCION` vacía**: deja de ser una variable que hay que acordarse de cargar en dos entornos y pasa a ser una fila que siembra la migración.

## Lo que NO cambia

- **`@gc/ai` sigue siendo la única puerta a un modelo**, y el único que sabe que OpenRouter existe.
- **La web sigue sin poder alcanzar el modelo.** La pantalla escribe una fila; generar sigue siendo del worker.
- **Los niveles.** `razonamiento`, `redaccion` y `utilitario` siguen siendo los mismos, y siguen siendo la razón por la que el modelo que escribe un post no es el que razona la estrategia.
- **El respaldo.** Existe hoy y está en uso; sigue existiendo.
- **Los precios que cobra OpenRouter.** El catálogo los muestra para poder elegir; no los negocia ni los controla.

## Las dos tablas

### `model_catalog` — el menú, global

Sin `organization_id`: es configuración del sistema, no datos de un inquilino. Las tres marcas eligen del mismo menú.

- el identificador del modelo tal como lo conoce OpenRouter,
- el `level` al que pertenece, con su `CHECK`,
- una etiqueta legible en español y para qué sirve,
- el precio de entrada y el de salida, por millón de tokens,
- una `modality`, hoy `chat` en todas.

Única sobre `(level, model_id)`: el mismo modelo puede servir en dos niveles, pero no aparecer dos veces en el mismo.

**La `modality` es lo único que existe hoy pensando en mañana**, y se justifica: el bloque 2D trae las imágenes, que **no son otro nivel sino otra modalidad**. Todo `@gc/ai` está construido alrededor de pedir un JSON y validarlo con Zod; un modelo de imágenes devuelve una imagen. Sin esa columna, 2D tendría que migrar la tabla antes de poder sembrar nada. Con ella, siembra sus filas y la pantalla las muestra sola.

### `organization_models` — la elección

Una fila por organización y nivel: el principal, un respaldo opcional, y quién lo cambió y cuándo. Única sobre `(organization_id, level)`.

El respaldo **no se inventa acá**: hoy `MODELO_RAZONAMIENTO_RESPALDO` apunta a `tencent/hy3` y se usa. Quitarlo sería una regresión. Puede quedar en «ninguno», que es como se comporta hoy la variable vacía.

### La siembra

La migración siembra las dos tablas: el catálogo con **tres o cuatro candidatos por nivel** —más que eso deja de ser un menú y vuelve a ser un catálogo— y la elección inicial con lo que hoy vive en el `.env`: `deepseek/deepseek-v4-flash-0731` con `tencent/hy3` de respaldo para razonamiento, más un modelo de redacción elegido del catálogo.

**Los identificadores y los precios del catálogo se verifican contra OpenRouter antes de escribir la migración.** No es ceremonia: en este proyecto ya se propuso una vez un modelo que no existía, y se descubrió al configurarlo. Una migración que siembra un identificador inválido deja el sistema sin poder generar y solo se nota al intentarlo.

**Una organización creada después de la migración nace sin elección**, porque la siembra corre una sola vez. No se le inventa un valor por omisión: la pantalla la muestra sin elegir y generar falla con el mensaje que manda a elegir. Es la misma dirección de falla que el resto del sistema —fallar cerrado y decir el remedio— y evita que alguien pague un modelo que nunca eligió.

## Cómo se resuelve al generar

**Las consultas viven en `@gc/operaciones`**, que es el paquete de operaciones compartidas entre CLI, web y worker. Una sola consulta: la misma que alimenta la pantalla alimenta la generación. Ponerla en `@gc/ai` dejaría dos lectores de las mismas tablas, y `pendientes.md` ya registra tres deudas de la forma «dos listas sincronizadas a mano».

La arista ya existe —`@gc/flujos` depende de `@gc/operaciones`— y la dirección es segura: `@gc/operaciones` **no** depende de `@gc/flujos`, así que la web sigue sin alcanzar el modelo y `comprobar:aislamiento` sigue verde.

**`@gc/flujos` resuelve antes de llamar** y pasa los modelos en `ContextoDeEjecucion`, al lado de `registrarUso`. Son tres sitios de llamada, en dos archivos.

Eso sigue un patrón que el archivo ya tiene: `ejecutarTarea` **no** escribe `ai_calls` —lo hace quien llama, por el callback `registrarUso`—, así que «esto lo necesito, pero no es mío» ya se resuelve pidiéndolo en el contexto. Elegir el modelo entra por la misma puerta.

**`@gc/ai` deja de leer el entorno.** `resolverNivel` y su mapa de variables por nivel se borran. El paquete queda como lo que dice ser, y sus pruebas siguen sin necesitar base.

**Se resuelve por corrida, al generar.** Cambiar el modelo afecta la generación siguiente, no una en vuelo. Y como la llamada al modelo vive en el primer paso de cada flujo, una corrida reanudada no mezcla modelos: el segundo paso no llama al modelo.

**Sin fila, falla cerrado**, con un `permanente` que nombra la pantalla — el mismo trato que hoy da la variable ausente, pero mandando a un lugar donde se puede arreglar.

## La pantalla

Ruta nueva **fuera de `[marca]`**, porque la elección es de la organización: `/configuracion`. Con su propio `force-dynamic`.

Renderiza **un bloque por nivel que exista en el catálogo**, no una lista fija: cuando 2D siembre modelos de imagen, la pantalla crece sola. Hoy se ven dos —razonamiento y redacción—; `utilitario` no aparece porque no tiene candidatos y nadie lo usa.

Cada bloque dice para qué sirve ese nivel **en palabras del usuario**, no en jerga: «razonamiento — decide la estrategia del trimestre y arma la grilla del mes», «redacción — escribe el texto de cada pieza». Debajo, el selector del principal y el del respaldo, cada opción con su etiqueta y su precio.

Guardar pasa por el ayudante `ejecutar` de `apps/web/src/acciones.ts`, como las once acciones que ya hay. Una que no lo use nace sin comprobación de sesión.

## Cómo se retiran las variables, y en qué orden

El orden no es negociable, y es la lección que este proyecto ya pagó dos veces:

1. **La migración se aplica a Cloud SQL antes de fusionar.** Con el código nuevo desplegado y sin las tablas, *toda* generación falla.
2. Al revés no pasa nada: con las tablas puestas y el código viejo corriendo, el worker sigue leyendo el entorno y nadie se entera.
3. Recién con el código desplegado se borran las seis variables `MODELO_*` de Cloud Run. Es limpieza, no un paso funcional.

En el repositorio se van del `.env` y del `.env.example`.

## La regla de `CLAUDE.md` que cambia

Hoy dice: **«Los modelos se leen del entorno, nunca literales en código.»**

Pasa a decir que se eligen desde la pantalla y viven en la base, **con el porqué al lado**: los identificadores siguen sin ser literales en código —que era el punto real de la regla— pero dejan de venir del entorno, porque elegir modelo resultó ser una decisión de producto que se toma leyendo lo que el modelo produce.

Dejar ese porqué escrito es la parte que importa. En este proyecto las reglas existen porque romperlas costó trabajo, y una que cambia sin explicación es exactamente cómo alguien la vuelve a romper.

## Cómo se verifica

1. **Las consultas, contra base real:** que la elección se lea por organización, que una organización sin fila falle con el mensaje que nombra la pantalla, y que el catálogo no devuelva candidatos de otro nivel.
2. **Que `@gc/ai` ya no lea el entorno:** borrar las variables no cambia nada de su comportamiento. Es la prueba que fija que la retirada ocurrió de verdad.
3. **El flujo, con el cliente falso:** que el modelo que llega al cliente sea el elegido en la base y no otro. Se verifica cambiando la fila y comprobando que la llamada cambia.
4. **La pantalla:** que muestre un bloque por nivel del catálogo, que el selector ofrezca solo candidatos de ese nivel, y que guardar escriba la fila.
5. **La que ninguna reemplaza:** cambiar el modelo desde la pantalla, generar, y confirmar en `ai_calls` que la llamada usó el modelo nuevo.

Advertencia que este repositorio se ganó: **una prueba puede afirmar contra el documento entero y parecer que verifica el lugar correcto**, y un nombre de prueba puede prometer dos cosas y afirmar una. Van veinticuatro encontradas, siete en el bloque anterior. Cada prueba se valida rompiendo el código y exigiendo que se ponga roja **por la razón exacta**.

## Riesgos

**Que el catálogo apunte a un modelo que OpenRouter dejó de servir.** No se descubre hasta que una generación falla. El `.env` tenía el mismo problema, así que no es peor — pero la pantalla invita a cambiarlo más seguido. La mitigación es que el selector solo ofrezca lo que está en el catálogo y que el catálogo se cure por migración.

**Que la pantalla invite a cambiar de modelo sin medir.** Elegir bien exige leer lo que produce cada uno, y la pantalla no muestra eso. El riesgo es cambiar por intuición y no saber si mejoró. No se mitiga en este bloque: los datos para compararlos están en `ai_calls` y mostrarlos es otro alcance.

**Que la retirada del entorno se haga a medias.** Si queda un lector del `.env` en algún camino, habría dos fuentes de verdad y la pantalla podría mostrar un modelo mientras el worker usa otro — el defecto exacto que la decisión de retirar el entorno existe para evitar. Por eso la verificación 2 es una prueba y no una revisión.

## Fuera de alcance

- **Los modelos de imagen** — bloque 2D. La `modality` les deja el lugar; sembrarlos y usarlos es de allá.
- **Administrar el catálogo desde la pantalla.** Agregar o quitar candidatos es una migración, que en este proyecto es operación normal.
- **Comparar modelos con datos.** Lo que costó y cuánto tardó cada uno está en `ai_calls`; mostrarlo es otro bloque.
- **Roles y permisos.** Cualquiera de la lista de correos permitidos puede cambiarlo, como en todo el resto del sistema.
- **El nivel `utilitario`.** Existe en el tipo y no lo usa nadie; no se le siembran candidatos hasta que algo lo use.
