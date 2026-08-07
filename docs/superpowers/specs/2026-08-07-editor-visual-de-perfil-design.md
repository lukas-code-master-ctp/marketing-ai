# El perfil de marca deja de editarse como JSON

**Fecha:** 2026-08-07
**Estado:** diseño aprobado, pendiente de plan
**Rama:** `feat/editor-visual-de-perfil`

## Por qué existe este bloque

`EditorDePerfil.tsx` presenta el perfil de marca como un `textarea` con JSON crudo. Su comentario dice que fue deliberado:

> El perfil se edita como JSON crudo en un textarea, a propósito: cubre el mismo esquema que un formulario por campo por una fracción del esfuerzo, y el perfil cambia con poca frecuencia.

El argumento tiene un agujero que el uso real destapó: **el perfil se toca poco, pero la primera vez es cuando más ayuda hace falta, y es la única vez por la que todos pasan.** Al crear la segunda marca del sistema, la pantalla que recibió al dueño fue un editor de JSON con llaves, corchetes y comas, para escribir la identidad de su empresa.

Y no es un problema cosmético. Este perfil **se convierte literalmente en parte del prompt** que recibe el modelo (`contextoDeMarca`, en `packages/brand/src/perfil.ts`). Un perfil escrito a la rápida —porque la pantalla desalienta detenerse— produce contenido genérico durante todo el mes. La calidad de la pantalla se traduce en calidad del contenido.

## Lo que NO cambia

Vale decirlo primero porque delimita el riesgo:

- **El esquema `PerfilDeMarca`** y `validarPerfil`, con todas sus reglas.
- **La Server Action `guardarPerfilAction(slug, textoJson)`**, con su firma y su comportamiento.
- **El versionado**: cada guardado sigue creando una versión nueva y el historial sigue siendo de solo lectura.
- **El CLI** (`perfil:cargar --archivo`) y el formato del archivo.
- **El prompt** y todo lo que hay debajo de la web.

**Es un cambio puramente de la capa web.** El formulario mantiene el perfil como objeto en memoria y lo serializa a JSON al guardar, llamando a la misma acción con el mismo texto que hoy se escribe a mano.

Esa propiedad es la que hace este bloque seguro: un defecto del formulario no puede persistir nada que el esquema no acepte ya.

## La pantalla

Una sola página con las siete secciones del perfil en orden, y no un asistente por pasos: llenar esto no es un trámite lineal sino un documento que se recorre hacia adelante y hacia atrás, corrigiendo el tono después de haber escrito los públicos. El historial de versiones se queda en su costado derecho, sin cambios.

| Sección | Campos | Reglas del esquema que la forma tiene que respetar |
|---|---|---|
| Posicionamiento | categoría, promesa, diferenciadores | al menos **un** diferenciador |
| Públicos | lista de {nombre, dolor, objeción} | al menos **un** público |
| Tono | atributos, qué sí hace, qué nunca | al menos **un** atributo |
| Léxico | preferidas, prohibidas | pueden ir vacías |
| Pilares | lista de {nombre, descripción, porcentaje} | al menos **dos**, nombres únicos, proporciones que sumen 1 |
| Ofertas | lista de {nombre, descripción, enlace} | puede ir vacía; el enlace es opcional |
| Restricciones | disclaimers | puede ir vacía |

Cada campo lleva **etiqueta en español, una línea que explica para qué sirve, y un ejemplo concreto**. Los ejemplos se toman del perfil real de `parcelas` —`perfiles/parcelas.json` y `packages/brand/src/perfil.fixture.ts`—: describen una marca de verdad y son coherentes entre sí, que es lo que un ejemplo inventado campo por campo no consigue.

**Se copian como texto literal dentro de `apps/web`, no se importan.** `apps/web` no declara `@gc/brand` —se le quitó a propósito en un bloque anterior— y agregarlo solo para leer ejemplos ampliaría el cierre de dependencias que `pnpm comprobar:aislamiento` audita, a cambio de nada: son textos de interfaz, se van a reescribir para que quepan junto a su campo, y no tienen por qué seguir al fixture si este cambia.

Las listas llevan botones de agregar y quitar. **Quitar no está disponible cuando dejaría la lista por debajo de su mínimo** — no se puede borrar el único público, ni bajar de dos pilares. Es preferible a dejar borrar y fallar al guardar.

## Los pilares, que es el único control no evidente

Es donde el esquema es más estricto y donde la gente se equivoca.

**Las proporciones se editan como porcentajes enteros** —`40`, no `0.4`— con un total en vivo debajo: en verde cuando suma 100, y en rojo indicando cuánto falta o sobra cuando no. La conversión a decimales ocurre al serializar.

Usar enteros **evita un problema en vez de explicarlo**: tres pilares en `0.33` suman `0.99` y `0.333` no es representable, mientras que `33 + 33 + 34` da exactamente 100 y se convierte en `0.33 + 0.33 + 0.34`. `validarPerfil` tolera una desviación de 0,01, así que ambos casos pasarían — pero el usuario no tiene por qué saber que existe una tolerancia, y con enteros el total que ve es el total que hay.

**El nombre en `snake_case` deja de ser una regla que recordar.** El campo acepta lo que se escriba y muestra debajo cómo va a quedar: «Prueba de manejo» → `prueba_de_manejo`. La conversión ocurre al serializar. Un nombre que la conversión deje vacío o que empiece con un dígito —`snake_case` exige que el primer carácter sea una letra— se marca en el campo, porque ahí la conversión no puede adivinar qué quiso decir.

**Los nombres repetidos se avisan en la lista**, no al guardar.

## Quién manda en la validación

**El esquema Zod sigue siendo la única autoridad.** El formulario da avisos mientras se escribe, pero no decide: al guardar, `validarPerfil` corre y su mensaje es el que se muestra, tal cual, como hoy.

Esto no es un detalle de implementación sino la regla que evita un defecto conocido de este repositorio. `pendientes.md` ya registra uno de esta forma exacta —«las reglas bloqueantes de `validacion.ts` y los filtros de `derivados.ts` son dos listas sincronizadas a mano»— y agregar una tercera copia de las reglas del perfil en el formulario sería repetirlo.

Concretamente, **el formulario no vuelve a declarar los mínimos de longitud** (categoría ≥ 3, promesa ≥ 10, dolor ≥ 10, y el resto). Solo previene por construcción lo que puede prevenir sin duplicar una regla:

- que el total de los pilares no sume 100,
- que se borre un elemento por debajo del mínimo de su lista,
- que un nombre de pilar quede repetido o no convertible.

Los tres son propiedades de la **forma del control**, no reproducciones de una regla del esquema.

## La salida de emergencia

Al final de la página, una sección plegada y cerrada por omisión: **«Avanzado: ver o pegar el JSON»**.

Desplegada, muestra el JSON del estado actual del formulario, editable. Pegar uno válido lo carga en los campos; uno inválido muestra el error y no toca el formulario.

Existe por dos motivos concretos, no por completitud: que alguien pueda pasar un perfil ya armado y pegarlo de una vez, y que si al formulario le faltara un campo nadie quede bloqueado esperando a que se arregle. Sin ella, la única salida sería el CLI desde la terminal — justo de lo que este bloque viene a alejarse.

## Estructura

`EditorDePerfil.tsx` tiene hoy 111 líneas; con siete secciones se volvería inmanejable. Se parte en:

- **`EditorDePerfil.tsx`** — el orquestador: estado del perfil, guardado, historial de versiones, sección avanzada.
- **Primitivas reutilizables** — campo de texto con ayuda y ejemplo, lista de textos, lista de objetos. Son las que evitan que siete secciones sean siete copias casi iguales.
- **Una componente por sección**, que compone las primitivas.
- **Un módulo de conversión**, sin React: del objeto del formulario al JSON del esquema y de vuelta, incluidos los porcentajes y el `snake_case`.

Ese último módulo va aparte **porque es donde vive la lógica que puede fallar en silencio**, y aparte se prueba sin renderizar nada.

Se descarta una configuración declarativa que derive el formulario del esquema Zod: sería menos código y bastante más difícil de leer y de ajustar campo por campo, que es justo lo que este bloque necesita hacer.

## Cómo se verifica

**En la máquina**, con el arnés de componentes que el proyecto ya tiene (`jsdom` más `@testing-library/react`):

- **Ida y vuelta sin pérdida:** cargar un perfil completo, no tocar nada, guardar, y que el JSON enviado sea equivalente al original. **Es la prueba central**: atrapa un campo que el formulario no sepa representar, que es el riesgo principal de todo el bloque.
- Editar un campo y guardar manda el cambio.
- Agregar y quitar en una lista; que quitar no esté disponible en el mínimo.
- El total de pilares avisa cuando no suma 100, y los porcentajes se convierten a decimales al serializar.
- Un nombre de pilar se convierte a `snake_case`, y uno no convertible se marca.
- La sección avanzada muestra el estado actual, carga un JSON válido y rechaza uno inválido sin perder lo escrito.
- El módulo de conversión, aparte y sin render.

Advertencia que este repositorio se ganó: **una prueba de componente puede afirmar contra el documento entero y parecer que verifica el lugar correcto.** Ya ocurrió cuatro veces. Cada prueba de este bloque se valida rompiendo el código a propósito y exigiendo que se ponga roja por la razón exacta.

**Y lo que ninguna de esas reemplaza:** abrir la pantalla en el navegador y llenar el perfil de una marca de principio a fin. Si eso no se siente mejor que el JSON, el bloque falló aunque todo esté verde.

## Riesgos

**Un campo del esquema que el formulario no sepa representar.** Es el riesgo principal y por eso la prueba de ida y vuelta es la central. El caso más probable es `ofertas[].url`, que es opcional: un campo vacío tiene que producir la ausencia de la clave y no una cadena vacía, que el esquema rechazaría por no ser una URL.

**Que el formulario se vuelva una segunda fuente de reglas.** Tratado arriba; la defensa es no declarar los mínimos de longitud en ningún control.

**Que la conversión de `snake_case` sorprenda.** Alguien escribe un nombre, ve otro guardado, y no entiende. Se mitiga mostrando la conversión debajo del campo mientras se escribe, no después de guardar.

## Fuera de alcance

- **Que la IA proponga un borrador del perfil** a partir de una descripción en prosa. Evaluado y descartado para este bloque: es un flujo de generación nuevo, con su costo y su manejo de errores, y da para bloque propio.
- **Editar versiones anteriores o revertir a una.** El historial sigue siendo de solo lectura.
- **El CLI y el formato del archivo.**
- **Las demás pantallas.** La grilla y la estrategia no se tocan.
