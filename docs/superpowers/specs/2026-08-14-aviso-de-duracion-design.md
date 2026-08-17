# La pantalla dice cuánto lleva esperando

**Fecha:** 2026-08-14
**Estado:** diseño aprobado, pendiente de plan
**Rama:** `feat/aviso-de-duracion`

## Por qué existe este bloque

El panel de «generando» dice el paso y nada más: «Proponiendo la grilla…». No dice cuánto lleva.

Con la primera generación real medida en producción eso pasó de detalle a problema. La estrategia tardó **8,9 segundos**; la grilla, **4,2 minutos** —un solo paso, `proponer_grilla`, con una llamada al modelo de 253 segundos—. Cuatro minutos mirando un texto inmóvil se leen igual que una pantalla colgada, y el dueño abrió el diagnóstico creyendo que lo estaba.

Lo que faltaba no era saber cuánto falta: era **saber que sigue viva**.

## Lo que NO cambia

- **El dominio.** `encoladaHace` ya viaja en `CorridaEnCurso` y ya se calcula; no se agrega ninguna columna, consulta ni campo.
- **El refresco.** `EstadoDeCorrida` ya llama a `router.refresh()` cada dos segundos mientras la corrida esté viva, y para cuando deja de estarlo.
- **Los otros tres paneles** —fallida, interrumpida, abandonada— y sus umbrales.
- **`describirAntiguedad`.** Ver abajo: es el punto que decide el diseño.
- **Ninguna promesa de duración.** El panel no dice «suele tardar cuatro minutos». Con una sola medición de cada flujo, el sistema no puede sostener ese número, y una expectativa equivocada es peor que ninguna.

## El formateador nuevo, que es todo el diseño

`describirAntiguedad` redondea a minutos por encima de los 60 segundos: diría «4 minutos» y se quedaría inmóvil un minuto entero. Para un contador cuyo único trabajo es demostrar que algo sigue vivo, eso falla exactamente en la ventana que importa —entre el minuto uno y el cinco, que es donde ocurrió el susto—.

**No se toca**: sus dos consumidores actuales hablan de un pasado difuso —«no da señales desde hace 15 minutos», «nadie tomó esta generación en 3 minutos»— y ahí redondear se lee mejor que «15 min 3 s».

Se agrega **`describirDuracion`** al lado, en el mismo `packages/operaciones/src/senales.ts`:

- bajo el minuto, segundos: `42 s`;
- de un minuto arriba, minutos y segundos, **siempre con los dos**: `4 min 12 s`, y en el minuto exacto `1 min 0 s`. Los segundos no se omiten cuando son cero, porque el punto del contador es que el número se mueva: `1 min` a secas quedaría inmóvil sesenta segundos, que es el defecto que este bloque viene a arreglar.
- **Igual que su vecina, recorta la entrada antes de formatear:** `Math.max(0, Math.floor(segundos))`. Un negativo —relojes desfasados entre la base y el proceso— da `0 s`, y un fraccionario se trunca. No es una regla nueva; es la que `describirAntiguedad` ya aplica, y conviene que las dos coincidan.

Vive ahí por el mismo motivo que su vecina: `senales.ts` no importa nada en tiempo de ejecución, así que un componente de cliente puede consumirlo sin arrastrar drizzle ni el driver de Postgres al bundle del navegador.

## La pantalla

El panel azul pasa de

> Proponiendo la grilla…

a

> Proponiendo la grilla… (4 min 12 s)

y, en cola, de `En cola…` a `En cola… (12 s)`.

El número sale de `encoladaHace`, o sea **desde que se encoló**, no desde que empezó el paso actual. Es la lectura que le sirve a quien mira: cuánto llevas esperando desde que apretaste el botón. Como reanudar reinicia la marca de tiempo de la corrida, el contador vuelve a cero al reanudar, que es lo correcto.

Con el refresco de dos segundos, el número se mueve. Eso es todo lo que el bloque tiene que lograr.

## Cómo se verifica

- **El formateador, sin renderizar nada:** los dos tramos y sus bordes —59 s, 60 s, 61 s—, el minuto exacto (`1 min 0 s`), el singular y el plural, y que un negativo dé `0 s` y un fraccionario se trunque. Es una función pura y ahí es donde vive la lógica que puede fallar en silencio.
- **El panel, con el arnés de componentes:** que el texto de «generando» incluya la duración, con dos corridas de antigüedad distinta; y que el de «en cola» también.
- **Que `describirAntiguedad` siga intacta:** sus pruebas actuales no cambian, y el panel de interrumpida sigue diciendo minutos redondeados.

Advertencia que este repositorio se ganó: **una prueba de componente puede afirmar contra el documento entero y parecer que verifica el lugar correcto.** Ya ocurrió cuatro veces, y los dos bloques anteriores encontraron quince más. Cada prueba se valida rompiendo el código y exigiendo que se ponga roja por la razón exacta — y en este bloque hay una trampa concreta: afirmar `'4'` calzaría con cualquier cosa, incluido el periodo `2026-Q4` si el panel llegara a mostrarlo.

## Riesgos

**Que el contador no baste y el problema real sea la lentitud.** 4,2 minutos para una grilla es mucho, y este bloque no lo mejora: lo hace tolerable. Si molesta igual, lo que sigue es otro modelo para el nivel de razonamiento o partir P2 en llamadas más chicas, y las dos cosas son bloque propio.

**Que quede pareciendo una promesa.** El paréntesis dice tiempo transcurrido, no estimado. Si alguien lo lee como «va a tardar 4 min 12 s», la redacción falló; por eso el número va detrás del paso y no como una frase aparte.

## Fuera de alcance

- **Prometer una duración esperada**, hasta que haya suficientes corridas para calcularla de `ai_calls.latency_ms`.
- **Barras de progreso.** No hay forma de conocer el porcentaje; una barra mentiría.
- **La línea de tiempo de los pasos.** No resuelve el caso de un solo paso largo, que es este.
- **Hacer la generación más rápida.**
