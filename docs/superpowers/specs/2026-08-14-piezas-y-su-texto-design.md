# La grilla deja de ser una lista de intenciones

**Fecha:** 2026-08-14
**Estado:** diseño aprobado, pendiente de plan
**Rama:** `feat/piezas-y-su-texto`
**Bloque:** 2A, el primero de la Fase 2

## Por qué existe este bloque

La grilla dice *«el 12 de agosto, LinkedIn, pilar educación, ángulo X, con este brief»*. Eso es la **intención**. No existe una sola línea de texto publicable en todo el sistema: no hay tabla `content_piece`, no hay flujo P3, y el calendario aprobado sigue exigiendo que alguien se siente a escribir veinte piezas.

Este bloque produce **el texto**. Después de él, la grilla de un mes trae veinte borradores escritos, listos para leer.

Es el bloque que devuelve horas. La Fase 3 —publicar solo— automatiza el último paso y depende de trámites que pueden tardar meses; esta no depende de nadie.

## Lo que NO cambia

- **P1 y P2.** La estrategia y la grilla se generan igual.
- **El esquema de la grilla.** `plan_slots` no gana ni pierde columnas; la pieza apunta al slot.
- **El motor, la cola y el worker.**
- **Las imágenes**, el QA, la bandeja de aprobación y el modo asistido. Son 2B, 2C, 2D y 2E.

## Las cinco formas del copy

Un esquema Zod **discriminado por canal**, con la misma mecánica que ya usan `strategies.data` y `brand_profiles.data`.

| Canal | Campos |
|---|---|
| `linkedin` | `gancho`, `cuerpo`, `hashtags` |
| `facebook` | `cuerpo`, `hashtags` |
| `instagram` | `caption`, `hashtags`, `diapositivas` (lista de textos, puede ir vacía) |
| `tiktok` | `caption`, `guion` |
| `blog` | `titulo`, `bajada`, `cuerpo` |

**`gancho` en LinkedIn** es la primera línea, lo único que se ve antes de «ver más». Separarla no es cosmético: es el campo que decide si alguien lee el resto.

**`diapositivas` en Instagram** la llena el prompt cuando el `formato` del slot dice carrusel, y la deja vacía si no. La forma se discrimina por canal y no por la pareja canal-formato: una variante no justifica duplicar el esquema.

**`guion` en TikTok** es lo que se dice o se muestra. El video es Fase 6, pero el guion es texto y es exactamente lo que hace falta para grabarlo a mano.

**`cuerpo` del blog va en Markdown**, que es lo que consumen los sitios Next.js de las tres marcas.

### Lo que los esquemas deliberadamente NO llevan

**Ningún límite de caracteres.** El diseño general ya decidió dónde vive eso: `validar(pieza)` en la interfaz del conector, que *«corre antes de generar, no después: informa al generador de los límites del canal»*. Ponerlos también acá crearía la segunda lista de reglas sincronizada a mano que este repositorio ya arrastra tres veces, y `pendientes.md` las registra. En 2A los límites viajan **en el prompt como instrucción**, no como validación.

El modo de falla es benigno: un copy demasiado largo se ve al leerlo, y la Fase 3 lo va a rechazar antes de publicar.

## Dónde vive

**Tabla nueva `content_pieces`**, una fila por slot:

- `id`, `organization_id` (cascada), `plan_slot_id`, `channel`, `data` (`jsonb`), `brand_profile_version`, `created_at`.
- Única `(plan_slot_id)`: **un slot tiene como mucho una pieza**. Regenerar reemplaza.
- Foránea compuesta `(plan_slot_id, organization_id)` → `plan_slots`, que ya tiene la única `(id, organization_id)` que la sostiene.
- `channel` se copia del slot y lleva su `CHECK`. Es denormalización deliberada: el esquema discriminado necesita saber el canal para validar `data`, y leerlo del slot en cada validación obligaría a una consulta más en el único lugar donde importa que sea barato.
- `brand_profile_version` por el mismo motivo que en `strategies`: saber con qué versión del perfil se escribió cada pieza.

**Migración `0008`**, escrita a mano siguiendo `0007` como plantilla — `drizzle-kit generate` está roto en este repositorio desde la `0005` por los snapshots faltantes, y `pendientes.md` lo registra con el síntoma exacto.

### Lo que NO se crea todavía, y por qué

**`content_revisions` no.** El diseño general la describe como *«la señal de calidad más honesta del sistema»*: cada edición humana sobre una pieza generada, con `autor = 'ia' | 'humano'`. Pero **en 2A no hay editor** —es 2C—, así que todas las revisiones serían de la IA y la tabla no registraría ninguna señal. Se crea junto con el editor que la llena.

**Ninguna columna de estado.** La máquina de estados completa —`en_qa`, `en_revision`, `aprobada`, `agendada`— pertenece a los bloques que la usan. En 2A la pieza existe o no existe, y eso es todo lo que hay que saber. El progreso de la generación ya lo cuentan las corridas. Agregar estados que nadie lee sería adivinar el futuro; agregarlos después es una migración, que en este proyecto es una operación normal.

## El flujo P3

Dos pasos, como P1 y P2, y **por el mismo motivo**: que un fallo de la base no recobre una llamada al modelo ya pagada.

1. **`generar_copy`** — carga el slot, el perfil vigente y la estrategia del trimestre; arma el mensaje; llama al modelo con el esquema del canal.
2. **`persistir_pieza`** — escribe la fila con `onConflictDoUpdate` sobre `plan_slot_id`.

**Una corrida por pieza.** El botón encola veinte corridas independientes. El aislamiento que el diseño general exige —*«si falla el slot #14, los otros 29 siguen»*— sale gratis: cada corrida falla, se reintenta y se reanuda sola, porque es exactamente para lo que se construyó la cola. Regenerar una sola pieza es encolar una corrida más, sin caso especial.

El worker atiende hasta diez corridas por turno (`LIMITE_POR_PETICION`), así que un mes de veinte se resuelve en dos turnos; con Cloud Tasks despertándolo, son segundos entre uno y otro.

### Cinco prompts, y lo que comparten

Cada canal tiene su instructivo, en `packages/flujos/src/prompts/`. Lo que **no** se repite cinco veces: el contexto de marca y la estrategia se arman una sola vez y se inyectan en los cinco, igual que hoy hace P1.

Es el costo aceptado de haber elegido fidelidad sobre economía: cuando quieras cambiar el tono de todo, son cinco archivos.

### La guarda: la grilla tiene que estar aprobada

`encolarPiezas` se niega si el plan del mes no está en `aprobada`, con un error `permanente` que nombra el remedio.

No es burocracia: es la separación que el diseño general defiende — *«aprobar la grilla antes de que exista una línea de texto»*. Generar sobre un borrador invita a regenerar la grilla después y tirar veinte textos ya pagados.

Los slots en `descartado` se saltan.

## La pantalla

En la página de la grilla:

- **Un botón «Generar las piezas»**, visible cuando el plan está aprobado y queda al menos un slot sin pieza. **Encola solo los que no la tienen**, nunca los que ya la tienen: así apretarlo dos veces no vuelve a pagar el modelo por lo ya escrito, y el botón sirve igual para completar un mes que quedó a medias porque tres corridas fallaron. En 2A **no hay botón para regenerar una pieza suelta** — la arquitectura lo permite sin caso especial, pero la pantalla que lo ofrece es 2C, junto con el editor.
- **Un resumen del avance** mientras las corridas trabajan: «18 de 20 listas, 1 falló». Sale de contar, para el mes, los slots no descartados contra las piezas existentes y las corridas de `p3_pieza` fallidas. Hoy `EstadoDeCorrida` muestra **una** corrida; con veinte hace falta ese recuento. Es trabajo honesto de este bloque y no una sorpresa: es el precio de haber elegido una corrida por pieza. **Tiene que distinguir los tres casos que se parecen** —ninguna encolada todavía, todas listas, y algunas fallidas— porque un recuento que los confunda es peor que no tenerlo.
- **El panel de detalle de un slot muestra su pieza**, si existe: los campos del canal, en orden, con un botón para copiar el texto. En 2A es de solo lectura — editar es 2C.

## Cómo se verifica

1. **Los cinco esquemas**, sin renderizar nada: qué exige cada uno, y que el discriminado rechace un `data` de un canal contra otro.
2. **`encolarPiezas` se niega con la grilla en borrador**, y salta los descartados.
3. **El flujo, con el cliente falso**: que el mensaje lleve el contexto de marca, la estrategia y el ángulo y el brief del slot; y que un fallo al persistir no vuelva a llamar al modelo.
4. **La pantalla**: el botón aparece solo con la grilla aprobada, el resumen cuenta bien, y el panel muestra la pieza.
5. **La que ninguna reemplaza:** generar el mes de una marca real y **leer las veinte piezas**. Si el texto no sirve para publicar, lo que hay que arreglar son los prompts, no el código — y esa es la única forma de saberlo.

Advertencia que este repositorio se ganó: **una prueba de componente puede afirmar contra el documento entero y parecer que verifica el lugar correcto.** Ya ocurrió cuatro veces, y los tres bloques anteriores encontraron dieciséis más. Cada prueba se valida rompiendo el código y exigiendo que se ponga roja por la razón exacta.

## Riesgos

**Que el texto salga genérico.** Es el riesgo central y no se mide con pruebas: se mide leyendo. El perfil de marca, el encargo del trimestre y la estrategia ya empujan en contra, y el ángulo y el brief del slot son específicos por construcción. Si aun así sale plano, el arreglo son los prompts.

**Que veinte corridas ensucien la pantalla.** El resumen es la mitigación, y es lo que más fácil queda a medias: un recuento que no distinga «ninguna encolada» de «todas listas» sería peor que no tenerlo.

**Que el costo sorprenda.** No debería: con los números medidos, veinte piezas cuestan del orden de un centavo. Pero es la primera vez que el sistema hace veinte llamadas por una sola acción del usuario, y `exigirPresupuesto` corre en cada una.

## Fuera de alcance

- **El QA**, en sus dos capas — 2B.
- **La bandeja de aprobación y el editor**, y con ellos `content_revisions` — 2C.
- **Las imágenes**, la tabla `asset` y el bucket — 2D.
- **El modo asistido** — 2E.
- **Publicar** — Fase 3.
- **Generar automáticamente cerca de la fecha.** El diseño general lo pide a largo plazo; hoy se dispara con un botón, que es lo que el resto del sistema ya hace.
