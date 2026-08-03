#!/usr/bin/env node
// Comprueba de verdad la garantía "la web nunca llama al modelo": que
// `@gc/ai`, `@gc/pipeline` y `@gc/flujos` sean irresolubles desde `apps/web`
// y desde cada paquete que `apps/web/next.config.ts` transpila (los cinco
// listados en `transpilePackages`, no solo dos). Cualquiera de esos seis
// destinos (los cinco paquetes más la app) puede reabrir el agujero: pnpm
// materializa una dependencia dentro del `node_modules` del paquete que la
// declara, incluso si es `devDependency`, y eso la vuelve resoluble desde
// cualquier archivo de ese paquete — la web lo carga igual porque lo
// transpila entero.
//
// Se resuelve con `createRequire(<paquete>/package.json).resolve(...)`,
// nunca con `import()`: todos los paquetes del workspace se distribuyen como
// TypeScript sin compilar, así que `import()` rechaza para TODOS con
// `ERR_UNKNOWN_FILE_EXTENSION` — un catch genérico convertiría eso en "no
// resuelve" incluso para lo que sí está declarado, y sería una comprobación
// que no puede fallar.
//
// Por la misma razón hay un control positivo: desde `packages/flujos`, que
// sí depende de `@gc/ai` y `@gc/pipeline`, ambos deben resolver. Sin este
// control, un script roto que dijera "no resuelve" a todo pasaría en verde
// sin comprobar nada.

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const raizDir = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const rutaNextConfig = path.join(raizDir, 'apps/web/next.config.ts')

/**
 * Lee `transpilePackages` de `apps/web/next.config.ts` parseando su AST con
 * el compilador de TypeScript, en vez de repetir la lista a mano: así una
 * entrada nueva en esa lista queda auditada sola, sin tocar este script.
 */
function leerTranspilePackages(rutaArchivo) {
  const texto = readFileSync(rutaArchivo, 'utf8')
  const fuente = ts.createSourceFile(rutaArchivo, texto, ts.ScriptTarget.Latest, true)
  let paquetes = null

  function visitar(nodo) {
    if (
      ts.isPropertyAssignment(nodo) &&
      ts.isIdentifier(nodo.name) &&
      nodo.name.text === 'transpilePackages' &&
      ts.isArrayLiteralExpression(nodo.initializer)
    ) {
      paquetes = nodo.initializer.elements
        .filter(ts.isStringLiteralLike)
        .map((elemento) => elemento.text)
    }
    ts.forEachChild(nodo, visitar)
  }

  visitar(fuente)

  if (paquetes === null || paquetes.length === 0) {
    throw new Error(`No se encontró "transpilePackages" (o vino vacío) en ${rutaArchivo}`)
  }
  return paquetes
}

// Convención del monorepo: cada paquete `@gc/<nombre>` vive en
// `packages/<nombre>`. Si algún día deja de cumplirse, este mapeo es lo
// primero que hay que revisar.
function dirDePaquete(nombrePaquete) {
  const nombreCorto = nombrePaquete.replace(/^@gc\//, '')
  return path.join(raizDir, 'packages', nombreCorto)
}

const MODULOS_PROHIBIDOS = ['@gc/ai', '@gc/pipeline', '@gc/flujos']

function intentarResolver(dirPaquete, nombreModulo) {
  const requerir = createRequire(path.join(dirPaquete, 'package.json'))
  try {
    requerir.resolve(nombreModulo)
    return true
  } catch {
    return false
  }
}

const paquetesTranspilados = leerTranspilePackages(rutaNextConfig)

const objetivosNegativos = [
  { etiqueta: 'apps/web', dir: path.join(raizDir, 'apps/web') },
  ...paquetesTranspilados.map((nombre) => ({ etiqueta: nombre, dir: dirDePaquete(nombre) })),
]

let huboError = false
const lineasResumen = []

for (const objetivo of objetivosNegativos) {
  for (const modulo of MODULOS_PROHIBIDOS) {
    const resuelve = intentarResolver(objetivo.dir, modulo)
    if (resuelve) {
      huboError = true
      console.error(
        `✗ ${objetivo.etiqueta} puede resolver "${modulo}" y no debería: la web lo ` +
          `transpila, así que alcanzaría al modelo. Revisa las dependencias ` +
          `(incluidas devDependencies) declaradas en ${path.join(objetivo.dir, 'package.json')}.`,
      )
    } else {
      lineasResumen.push(`  ${objetivo.etiqueta}: NO RESUELVE ${modulo} (correcto)`)
    }
  }
}

// Control positivo: si esto falla, el script no distingue nada — cualquier
// script que dijera "no resuelve" a todo pasaría igual de verde.
const dirFlujos = dirDePaquete('@gc/flujos')
for (const modulo of ['@gc/ai', '@gc/pipeline']) {
  const resuelve = intentarResolver(dirFlujos, modulo)
  if (resuelve) {
    lineasResumen.push(`  packages/flujos: RESUELVE ${modulo} (control positivo, correcto)`)
  } else {
    huboError = true
    console.error(
      `✗ Control positivo roto: packages/flujos debería poder resolver "${modulo}" y no ` +
        'pudo. Si esto falla, la comprobación no distingue nada y no sirve de nada.',
    )
  }
}

if (huboError) {
  console.error('\nLa comprobación de aislamiento encontró fugas o un control roto. Ver arriba.')
  process.exit(1)
}

console.log('Aislamiento de @gc/ai y @gc/pipeline verificado.')
console.log(`Auditados (deben fallar): apps/web, ${paquetesTranspilados.join(', ')}`)
console.log(lineasResumen.join('\n'))
process.exit(0)
