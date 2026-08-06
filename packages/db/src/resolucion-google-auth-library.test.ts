import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const requerir = createRequire(import.meta.url)

/**
 * `Connector` decide si autenticar con `loginAuth instanceof GoogleAuth`
 * (dentro de `@google-cloud/cloud-sql-connector`, en su `sqladmin-fetcher`).
 * Ese `instanceof` solo es cierto si `google-auth-library` resuelve, para
 * `@gc/db` y para el conector, al MISMO archivo. Si pnpm instala dos copias
 * —porque el rango que declara el conector deja de coincidir con el que
 * declara `packages/db/package.json`— el objeto que arma `crearConexion` cae
 * por la rama equivocada, la petición sale sin credenciales, y el síntoma es
 * un `401 Login Required` en producción que no menciona versiones ni copias.
 * Ya pasó una vez, en la prueba de humo contra la instancia real.
 *
 * Nada más lo vigila: `pnpm test` y `pnpm -r typecheck` no ven qué copia
 * resuelve cada paquete, y el build tampoco. Por eso esta prueba, con la
 * misma forma que `pnpm comprobar:aislamiento`: afirma con
 * `require.resolve` en vez de confiar en que los rangos declarados
 * coincidan.
 */
describe('copia única de google-auth-library', () => {
  it('el conector de Cloud SQL y @gc/db resuelven el mismo archivo de google-auth-library', () => {
    const propia = requerir.resolve('google-auth-library')

    const entradaDelConector = requerir.resolve('@google-cloud/cloud-sql-connector')
    const delConector = requerir.resolve('google-auth-library', {
      paths: [path.dirname(entradaDelConector)],
    })

    expect(
      delConector === propia,
      `google-auth-library resolvió a DOS copias distintas:\n` +
        `  @gc/db:                              ${propia}\n` +
        `  @google-cloud/cloud-sql-connector:    ${delConector}\n\n` +
        'Con dos copias, el "loginAuth instanceof GoogleAuth" de dentro del ' +
        'conector (su sqladmin-fetcher) da falso aunque las credenciales estén ' +
        'bien construidas: el objeto cae por la rama equivocada y la petición ' +
        'sale sin credenciales. El síntoma en producción es un "401 Login ' +
        'Required" que no menciona versiones ni copias — así mordió la primera ' +
        'vez, en la prueba de humo contra la instancia real.\n\n' +
        'Arreglo: alinea el rango de "google-auth-library" en ' +
        'packages/db/package.json con el que exige ' +
        '@google-cloud/cloud-sql-connector (revisa su package.json), y corre ' +
        'pnpm install para que las dos vuelvan a resolver a una sola copia.',
    ).toBe(true)
  })

  it('@gc/despertador resuelve el mismo archivo que @gc/db', () => {
    // `@gc/despertador` importa `GoogleAuth` para firmar contra la API REST de
    // Cloud Tasks. Ese uso no depende del `instanceof` —solo pide un token—,
    // pero el paquete es un tercer declarante del mismo rango, y si el suyo se
    // despega del de `packages/db/package.json`, pnpm instala otra copia y esa
    // copia vuelve a poner en riesgo el `instanceof` del conector: basta con
    // que el hoisting cambie de mano. Se afirma por `require.resolve` y no
    // comparando los rangos declarados, por lo mismo que la prueba de arriba.
    //
    // Se llega por ruta del sistema de archivos y no por el nombre del
    // paquete: `@gc/db` no declara `@gc/despertador` —ni debe—, así que
    // `require.resolve('@gc/despertador')` no resolvería.
    const propia = requerir.resolve('google-auth-library')

    const delDespertador = requerir.resolve('google-auth-library', {
      paths: [path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../despertador/src')],
    })

    expect(
      delDespertador === propia,
      `google-auth-library resolvió a DOS copias distintas:\n` +
        `  @gc/db:          ${propia}\n` +
        `  @gc/despertador: ${delDespertador}\n\n` +
        'Arreglo: alinea el rango de "google-auth-library" en ' +
        'packages/despertador/package.json con el de packages/db/package.json, y corre ' +
        'pnpm install.',
    ).toBe(true)
  })
})
