/**
 * Arma el texto que el dueño de la marca copia y le pasa a una IA externa
 * —una que ya conoce su empresa— para que complete el perfil y lo pegue de
 * vuelta en la sección «Avanzado» del editor.
 *
 * Sin este archivo, lo que se copiaba era el esqueleto solo: `"publicos": []`
 * no le dice a nadie que cada público lleva nombre, dolor y objeción. El
 * texto de las reglas, más abajo, es lo que lo dice.
 *
 * Las reglas son una **copia** de las que declara `PerfilDeMarca`
 * (`packages/brand/src/perfil.ts`). `apps/web` no puede importar ese
 * paquete —la regla de aislamiento se lo impide, ver `CLAUDE.md`—, así que
 * quedan escritas literales acá. Si el esquema cambia, hay que actualizar
 * estas reglas a mano.
 */

import { haciaElPerfil, type PerfilEnFormulario } from './conversion.js'

const REGLAS = `- \`categoria\`, \`promesa\` y al menos un \`diferenciador\` son obligatorios.
- Al menos un público, y cada uno lleva \`nombre\`, \`dolor\` y \`objecion\`. El
  dolor es el problema que esa persona tiene hoy; la objeción es lo que la
  frena justo antes de decidirse.
- Al menos un atributo de tono.
- Dentro de \`tono\`, además de los atributos: \`hacer\` es lo que la marca sí
  hace al comunicarse y \`noHacer\` lo que nunca hace. Los dos son opcionales
  —si no tienes información, deja la lista vacía (\`[]\`) en vez de una línea
  en blanco—.
- **Al menos dos pilares.** Cada uno lleva \`nombre\` en \`snake_case\`
  —minúsculas, sin acentos, con guiones bajos, empezando por una letra—,
  \`descripcion\`, y \`proporcion\`. Los nombres de pilar no se repiten entre sí.
- Las proporciones van de 0 a 1 —no en porcentaje— y **suman exactamente 1**
  entre todos los pilares.
- Las ofertas son opcionales —la lista puede quedar vacía (\`[]\`)—, pero cada
  oferta que incluyas lleva \`nombre\` y \`descripcion\`. La \`url\` es opcional
  dentro de cada una: si no la tienes, **quita la clave \`url\` entera** en vez
  de dejarla en \`""\`, porque una cadena vacía no es una dirección válida y se
  rechaza.
- \`lexico\` es el vocabulario de la marca: en \`preferido\` van las palabras y
  expresiones que la marca sí usa —los términos propios de su negocio, cómo le
  llama a lo que vende—, y en \`prohibido\` las que nunca usa —promesas que no
  puede sostener, muletillas, jerga que confunde—. Las dos claves van siempre:
  si no tienes información, deja la lista vacía (\`[]\`) en vez de quitarla. Pero
  llénalas si conoces la empresa, que es lo que evita que el contenido suene
  genérico.
- \`disclaimers\` puede ir vacío.`

const INSTRUCCION_DE_CIERRE = `Devuelve SOLO el JSON completo, sin explicaciones alrededor y sin envolverlo
en un bloque de código, para que se pueda pegar de vuelta sin editar. No
dejes filas vacías: si no tienes información para una oferta o un disclaimer,
quítalo en vez de dejarlo en blanco.`

/**
 * Arma el prompt completo: la instrucción, las reglas, y al final el
 * esqueleto con lo que ya se escribió en el formulario —lo último que se lee
 * es lo que hay que llenar—.
 *
 * El esqueleto conserva las filas y los textos vacíos (`conservarVacios:
 * true`) a propósito: es la única forma de que el JSON muestre las claves de
 * cada público y de cada pilar sin que la IA tenga que adivinarlas. Con las
 * ofertas no alcanza —el formulario vacío no trae ninguna, así que el
 * esqueleto muestra `"ofertas": []` y no hay claves que mostrar—, y por eso
 * `REGLAS` las nombra una por una en prosa. Lo mismo con `preferido` y
 * `prohibido` de `lexico`, que son listas de textos sueltos y no de objetos:
 * sus claves están, pero nada dice qué va adentro.
 */
export function promptParaIa(marca: string, formulario: PerfilEnFormulario): string {
  const esqueleto = JSON.stringify(haciaElPerfil(formulario, { conservarVacios: true }), null, 2)

  return [
    `Este es el perfil de marca de ${marca}. Complétalo con la información que ya tienes de la empresa, siguiendo al pie de la letra las reglas de abajo.`,
    '',
    REGLAS,
    '',
    INSTRUCCION_DE_CIERRE,
    '',
    esqueleto,
  ].join('\n')
}
