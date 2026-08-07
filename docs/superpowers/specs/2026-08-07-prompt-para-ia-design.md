# La sección avanzada muestra el formulario, y ofrece un prompt para una IA externa

**Fecha:** 2026-08-07
**Estado:** diseño aprobado, pendiente de plan
**Rama:** `feat/prompt-para-ia`

## Por qué existe este bloque

El editor visual del perfil dejó una sección plegada, «Avanzado: ver o pegar el JSON», pensada para dos cosas: copiar el perfil y pegar uno ya armado.

El dueño encontró un tercer uso, mejor que los dos previstos: **copiar el JSON, dárselo a una IA que ya conoce su empresa, pedirle que lo complete, y pegar el resultado de vuelta.** Lo intentó con la marca `tapcar` y el resultado quedó incompleto.

No fue culpa de la IA. Esto es lo que recibió:

```json
{
  "posicionamiento": { "categoria": "", "promesa": "", "diferenciadores": [] },
  "publicos": [],
  "tono": { "atributos": [], "hacer": [], "noHacer": [] },
  "pilares": [],
  "ofertas": [],
  "restricciones": { "disclaimers": [] }
}
```

`"publicos": []` no dice que cada público lleva **nombre, dolor y objeción**. `"pilares": []` no dice que llevan **nombre, descripción y proporción**, ni que hacen falta **al menos dos**, ni que el nombre va en `snake_case`, ni que las proporciones **suman 1**, ni que van de 0 a 1 y no en porcentaje.

Lo que se copió no era un formulario incompleto: era **un esqueleto sin instrucciones**. Que la IA lo completara mal era inevitable.

Y hay una segunda causa detrás de la primera: **la sección avanzada no muestra el formulario, muestra lo que se guardaría** — y la conversión de guardado descarta las filas vacías. Por eso el esqueleto llegó sin ellas.

## Lo que NO cambia

- El esquema `PerfilDeMarca` y `validarPerfil`.
- La Server Action, el versionado y el CLI.
- **El descarte de filas vacías al guardar.** Sigue siendo lo que evita que el esquema se queje de un elemento que nadie llenó, que es el motivo por el que existe.
- Las siete secciones del formulario y el control de pilares.

**Es un cambio acotado a la sección avanzada** de `EditorDePerfil` y a una opción nueva en el módulo de conversión.

## La sección avanzada deja de mostrar otra cosa

Hoy muestra el resultado de la conversión de guardado, que **no es lo que hay en pantalla**: las filas vacías desaparecieron. Alguien con una tarjeta «Público 1» delante ve `"publicos": []` y concluye, razonablemente, que algo se perdió.

**Pasa a mostrar el formulario completo, con sus filas vacías.**

Las dos cosas para las que la sección existe mejoran: copiar da la forma entera, y pegar de vuelta reconstruye el formulario tal cual. El descarte de vacíos se queda donde corresponde —al guardar—, que es un detalle del guardado y no tenía por qué asomarse al editor.

### La trampa que hay que evitar, o el pegado se rompe

El estado del formulario tiene **`porcentaje: 40`**; el esquema tiene **`proporcion: 0.4`**. Si la sección mostrara el estado crudo del formulario, pegarlo de vuelta fallaría al leerlo, porque `desdeElPerfil` espera `proporcion`.

**La sección sigue mostrando la forma del esquema.** Lo único que cambia es que no descarta las filas vacías: misma conversión, con una opción que las conserva.

## El prompt

Bajo el área de texto, un botón **«Copiar prompt para IA»** que pone en el portapapeles un texto con tres partes.

**El esqueleto, generado del formulario actual y no escrito a mano.** Tiene una consecuencia deseable: si ya llenaste la mitad, el prompt lleva lo que escribiste y la instrucción es **completar el resto**, no inventarlo todo de nuevo. Y como se genera, no puede quedar desactualizado respecto de la forma real.

**Las reglas en prosa.** Es lo que hoy falta y por lo que la IA adivinó:

- categoría, promesa y al menos un diferenciador;
- al menos un público, cada uno con nombre, dolor y objeción;
- al menos un atributo de tono;
- **al menos dos pilares**, con nombre en `snake_case`, descripción, y proporciones de 0 a 1 que **suman 1**;
- las ofertas son opcionales, y el enlace de cada una también;
- el léxico y los disclaimers pueden ir vacíos.

**La instrucción:** completar con lo que se sepa de la marca —nombrada por su nombre, que la pantalla ya tiene— y devolver **solo JSON**, sin explicaciones alrededor, para que se pueda pegar de vuelta sin editar.

Nada de esto llama a ningún modelo desde la aplicación. **Es texto.** No cuesta, no falla, y no hay nada que reintentar.

### Copiar sin depender del portapapeles

`navigator.clipboard` exige contexto seguro y puede ser denegado por permisos. El prompt vive en un elemento del que se puede **seleccionar y copiar a mano**, y el botón es una comodidad encima: si la escritura al portapapeles falla, se dice y el texto sigue ahí.

## La costura que hay que vigilar

Las reglas del prompt describen un esquema Zod que vive en `@gc/brand`, y **`apps/web` no puede importarlo**: es una regla de arquitectura con guardián en CI. Ese texto es entonces **una copia**, y si el esquema cambia, el prompt miente.

No hay forma de atarlos sin romper el aislamiento. Lo que sí se hace:

1. **El esqueleto no es copia sino generado**, y es la parte que más se equivocaría.
2. El texto lleva un comentario que nombra `packages/brand/src/perfil.ts` como la fuente.
3. Se suma a la entrada de `pendientes.md` que ya registra la copia del `snake_case`, en vez de fingir que no existe.

## Cómo se verifica

**En la máquina:**

- Que el JSON de la sección avanzada, tomado y vuelto a cargar sin tocarlo, **reconstruya el mismo formulario**, incluidas las filas vacías. Es la garantía de que el cambio de §«La sección avanzada» no rompió el pegado.
- Que el JSON mostrado conserve las claves de una fila vacía —un público en blanco aparece como objeto con sus tres claves, no desaparece.
- Que **guardar siga descartando** las filas vacías: el cambio no debe filtrarse al camino de guardado.
- Que el prompt contenga el esqueleto **y** las reglas **y** el nombre de la marca.
- Que el fallo al escribir en el portapapeles se informe y no rompa nada.

Advertencia que este repositorio se ganó: **una prueba de componente puede afirmar contra el documento entero y parecer que verifica el lugar correcto.** Ya ocurrió cuatro veces. Cada prueba se valida rompiendo el código y exigiendo que se ponga roja por la razón exacta.

**Y la que ninguna reemplaza, que hace el dueño:** copiar el prompt, pegarlo en su herramienta con lo que sabe de `tapcar`, y comprobar que lo que devuelve **entra sin errores**. Si no entra, lo que falta son reglas en el prompt, no código.

## Riesgos

**Que el prompt produzca JSON que el esquema rechace igual.** Es el riesgo central y no se puede eliminar desde acá: depende de la IA de destino. Se mitiga con reglas explícitas, y el modo de falla es benigno —el perfil no entra y se ve el error— pero conviene medirlo en la verificación del dueño antes de darlo por bueno.

**Que mostrar las filas vacías confunda por el otro lado**: alguien copia el JSON, lo guarda como archivo y lo carga por el CLI, donde las filas vacías **sí** llegan al esquema y lo hacen fallar. El CLI no descarta nada. Es un camino real y conviene que el prompt pida no incluir filas vacías en la respuesta.

## Fuera de alcance

- **Que el sistema genere el borrador llamando al modelo.** Sigue descartado por lo mismo de siempre: es un flujo de generación con su costo y su manejo de errores, y da para bloque propio. Este bloque hace innecesario buena parte de eso.
- **Cambiar qué se guarda.** El descarte de vacías al guardar no se toca.
- **Las demás pantallas.**
