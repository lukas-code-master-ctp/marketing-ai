#!/usr/bin/env node
// Comprueba de verdad la garantía "la web nunca llama al modelo": que
// `@gc/ai`, `@gc/pipeline` y `@gc/flujos` sean irresolubles desde `apps/web`
// y desde cada paquete del workspace que `apps/web` arrastra, directo o
// transitivo. Cualquiera de esos destinos puede reabrir el agujero: pnpm
// materializa una dependencia dentro del `node_modules` del paquete que la
// declara, incluso si es `devDependency`, y eso la vuelve resoluble desde
// cualquier archivo de ese paquete — la web lo carga igual, porque un paquete
// que está en su cierre de dependencias termina en su bundle.
//
// El conjunto auditado sale del **cierre transitivo de dependencias de
// workspace de `apps/web`**, recorriendo los `package.json` desde ahí hacia
// abajo. Antes salía de `transpilePackages` en `apps/web/next.config.ts`, y
// eso era un conjunto que se podía reducir en silencio: ese mismo archivo
// documenta que su lista NO controla la resolución, así que quitar una
// entrada dejaba de auditar un paquete sin cambiar nada de lo que la web
// realmente carga. El cierre de dependencias no se puede achicar sin cambiar
// el grafo de verdad, que es justo la regresión que esto vigila.
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
//
// Lo que esta comprobación NO es: una garantía del bundler. El webpack de
// Next resuelve `@gc/ai` desde `apps/web` igual, porque su `resolve.modules`
// incluye `node_modules/.pnpm/node_modules`, el almacén plano de pnpm, donde
// hay un enlace a todos los paquetes del workspace. Ver CLAUDE.md: quien
// bloquea el import escrito a mano es `tsc --noEmit`; quien vigila el grafo
// de dependencias es este script; y quien los ejecuta a los dos en cada push
// es CI.

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { indexarPaquetesDelWorkspace } from './workspace.mjs'

const PAQUETE_RAIZ = '@gc/web'
const MODULOS_PROHIBIDOS = ['@gc/ai', '@gc/pipeline', '@gc/flujos']

/**
 * Cierre transitivo de dependencias **de workspace** a partir de un paquete.
 *
 * Recorre `dependencies` y `devDependencies` por igual: pnpm materializa las
 * dos dentro del `node_modules` del paquete que las declara, así que las dos
 * vuelven a `@gc/ai` resoluble desde sus archivos. La primera vez que este
 * agujero apareció fue justamente por una `devDependency`.
 *
 * Devuelve el conjunto sin el paquete de partida.
 */
function cierreDeDependencias(nombreRaiz, indice) {
  const visitados = new Set()
  const pendientes = [nombreRaiz]

  while (pendientes.length > 0) {
    const nombre = pendientes.pop()
    const dir = indice.get(nombre)
    if (!dir) {
      throw new Error(
        `"${nombre}" aparece como dependencia de workspace pero no existe en el workspace. ` +
          'Revisa pnpm-workspace.yaml y los package.json.',
      )
    }
    const manifiesto = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
    const declaradas = [
      ...Object.keys(manifiesto.dependencies ?? {}),
      ...Object.keys(manifiesto.devDependencies ?? {}),
    ]
    for (const dep of declaradas) {
      if (!indice.has(dep)) continue // dependencia externa: no es del workspace
      if (visitados.has(dep) || dep === nombreRaiz) continue
      visitados.add(dep)
      pendientes.push(dep)
    }
  }

  return visitados
}

function intentarResolver(dirPaquete, nombreModulo) {
  const requerir = createRequire(path.join(dirPaquete, 'package.json'))
  try {
    requerir.resolve(nombreModulo)
    return true
  } catch {
    return false
  }
}

const indice = indexarPaquetesDelWorkspace()
const dirRaiz = indice.get(PAQUETE_RAIZ)
if (!dirRaiz) throw new Error(`No se encontró el paquete ${PAQUETE_RAIZ} en el workspace`)

const cierre = cierreDeDependencias(PAQUETE_RAIZ, indice)

let huboError = false
const lineasResumen = []

// Un cierre vacío significaría que el recorrido se rompió, y entonces el
// script no auditaría nada y pasaría en verde: exactamente la comprobación
// que no puede fallar que este cambio vino a eliminar.
if (cierre.size === 0) {
  huboError = true
  console.error(
    `✗ El cierre de dependencias de workspace de ${PAQUETE_RAIZ} salió vacío. El recorrido ` +
      'de package.json está roto y esta comprobación no estaría auditando nada.',
  )
}

// Fuga a nivel de grafo: si un módulo prohibido aparece en el propio cierre,
// la web lo arrastra por declaración y no hace falta resolver nada para
// saberlo. Se reporta aquí y se saca de los destinos, porque auditar
// "@gc/ai no resuelve @gc/ai" no diría nada.
const prohibidosEnElCierre = MODULOS_PROHIBIDOS.filter((m) => cierre.has(m))
for (const modulo of prohibidosEnElCierre) {
  huboError = true
  console.error(
    `✗ "${modulo}" está en el cierre transitivo de dependencias de ${PAQUETE_RAIZ}: algún ` +
      'package.json del camino lo declara. La web volvería a alcanzar al modelo.',
  )
}

const paquetesAuditados = [...cierre].filter((n) => !MODULOS_PROHIBIDOS.includes(n)).sort()

const objetivosNegativos = [
  { etiqueta: 'apps/web', dir: dirRaiz },
  ...paquetesAuditados.map((nombre) => ({ etiqueta: nombre, dir: indice.get(nombre) })),
]

for (const objetivo of objetivosNegativos) {
  for (const modulo of MODULOS_PROHIBIDOS) {
    const resuelve = intentarResolver(objetivo.dir, modulo)
    if (resuelve) {
      huboError = true
      console.error(
        `✗ ${objetivo.etiqueta} puede resolver "${modulo}" y no debería: está en el cierre de ` +
          `dependencias de ${PAQUETE_RAIZ}, así que alcanzaría al modelo. Revisa las ` +
          `dependencias (incluidas devDependencies) declaradas en ` +
          `${path.join(objetivo.dir, 'package.json')}.`,
      )
    } else {
      lineasResumen.push(`  ${objetivo.etiqueta}: NO RESUELVE ${modulo} (correcto)`)
    }
  }
}

// Control positivo: si esto falla, el script no distingue nada — cualquier
// script que dijera "no resuelve" a todo pasaría igual de verde.
const dirFlujos = indice.get('@gc/flujos')
if (!dirFlujos) {
  huboError = true
  console.error('✗ Control positivo roto: no se encontró @gc/flujos en el workspace.')
} else {
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
}

if (huboError) {
  console.error('\nLa comprobación de aislamiento encontró fugas o un control roto. Ver arriba.')
  process.exit(1)
}

console.log('Aislamiento de @gc/ai, @gc/pipeline y @gc/flujos verificado.')
console.log(
  `Cierre de dependencias de workspace de ${PAQUETE_RAIZ} ` +
    `(${paquetesAuditados.length} paquetes): ${paquetesAuditados.join(', ')}`,
)
console.log(lineasResumen.join('\n'))
process.exit(0)
