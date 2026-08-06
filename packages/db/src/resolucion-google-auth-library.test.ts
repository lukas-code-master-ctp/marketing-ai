import { createRequire } from 'node:module'
import path from 'node:path'
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
})
