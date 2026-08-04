#!/usr/bin/env node
// Guardián de la lista de volúmenes `node_modules` de `docker-compose.yml`.
//
// El servicio `worker` monta el repositorio entero en `/app` y tapa cada
// `node_modules` del workspace con un volumen propio. Si falta uno, el
// `pnpm install` que corre dentro del contenedor escribe **sobre el montaje**,
// o sea sobre el `node_modules` del host: enlaces con rutas del contenedor y
// binarios nativos de otra plataforma, en la instalación que usan `pnpm test`
// y la app web.
//
// Ese daño es silencioso. No lo ve ninguna prueba, ni el typecheck, ni CI:
// todos corren en el host, y el host solo se rompe cuando alguien levanta el
// contenedor. La lista está completa hoy; lo que no tenía era quién la
// mantuviera completa mañana, cuando se agregue un paquete al workspace.
//
// Va en un script aparte del de aislamiento —y no dentro de él— porque
// responden preguntas distintas: aquel audita el grafo de dependencias, este
// audita un archivo de configuración de Docker, y en CI conviene que fallen por
// separado para que el mensaje diga qué hay que arreglar. Lo que sí comparten,
// la expansión del workspace, está en `scripts/workspace.mjs`: es la parte que
// no puede divergir entre los dos.
//
// Igual que el de aislamiento, lleva **control positivo**, y aquí es
// imprescindible: un script que no supiera leer el compose reportaría "no
// falta nada" y pasaría en verde para siempre. El control borra la línea de
// cada paquete, una por una, y exige que el detector nombre exactamente ese
// paquete. Si el extractor se rompe, el control se cae antes que nada.

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { raizDir, indexarPaquetesDelWorkspace, rutaRelativa } from './workspace.mjs'

const RUTA_COMPOSE = path.join(raizDir, 'docker-compose.yml')
const SERVICIO = 'worker'

/**
 * Montajes con destino `/app/**\/node_modules` que declara el compose.
 *
 * Se lee por líneas y no con un parser de YAML a propósito: el proyecto no
 * tiene ninguno como dependencia, y lo que hay que auditar es exactamente el
 * texto de esas líneas. Se distinguen los anónimos (`- /app/...`) de los
 * nombrados (`- nm-x:/app/...`) porque volver a los anónimos es la otra
 * regresión que este archivo ya sufrió: `docker compose down` no los borra y
 * la única limpieza que se los lleva, `down -v`, destruye también `pgdata`.
 */
function extraerMontajes(lineas) {
  const nombrados = []
  const anonimos = []
  lineas.forEach((textoCrudo, indice) => {
    const texto = textoCrudo.split('#')[0]
    const conNombre = /^\s*-\s*([^\s:#]+):(\/app\/\S*)\s*$/.exec(texto)
    if (conNombre && conNombre[2].endsWith('/node_modules')) {
      nombrados.push({ volumen: conNombre[1], destino: conNombre[2], indice })
      return
    }
    const anonimo = /^\s*-\s*(\/app\/\S*)\s*$/.exec(texto)
    if (anonimo && anonimo[1].endsWith('/node_modules')) {
      anonimos.push({ destino: anonimo[1], indice })
    }
  })
  return { nombrados, anonimos }
}

/** Destino esperado por paquete del workspace, más el `node_modules` de la raíz. */
function montajesEsperados(indice) {
  const esperados = new Map([['/app/node_modules', 'la raíz del workspace']])
  for (const [nombre, dir] of indice) {
    esperados.set(`/app/${rutaRelativa(dir)}/node_modules`, nombre)
  }
  return esperados
}

/** Nombres de volumen declarados en el bloque `volumes:` de primer nivel. */
function volumenesDeclarados(lineas) {
  const declarados = new Set()
  let dentro = false
  for (const linea of lineas) {
    if (/^volumes:\s*$/.test(linea)) {
      dentro = true
      continue
    }
    if (!dentro) continue
    if (/^\S/.test(linea)) break // empezó otra sección de primer nivel
    const entrada = /^\s{1,4}([^\s:#]+):/.exec(linea.split('#')[0])
    if (entrada) declarados.add(entrada[1])
  }
  return declarados
}

/**
 * Compara lo que declara el compose contra lo que existe en el workspace.
 * Devuelve los problemas como texto; vacío es verde.
 */
function comparar(lineas, esperados) {
  const problemas = []
  const { nombrados, anonimos } = extraerMontajes(lineas)

  if (nombrados.length === 0 && anonimos.length === 0) {
    problemas.push(
      `No se encontró ningún montaje de node_modules en ${path.basename(RUTA_COMPOSE)}. O el ` +
        'servicio dejó de montar el repositorio, o este script dejó de saber leerlo: en los dos ' +
        'casos hay que mirarlo, porque tal como está no audita nada.',
    )
    return problemas
  }

  for (const { destino, indice } of anonimos) {
    problemas.push(
      `Línea ${indice + 1}: el montaje "${destino}" es un volumen anónimo. Ponle nombre ` +
        '(`nm-<paquete>:<destino>`): los anónimos quedan abandonados en cada `docker compose ' +
        'down` y la única limpieza que se los lleva, `down -v`, borra también `pgdata` con la ' +
        'base de desarrollo.',
    )
  }

  const declarados = new Map(nombrados.map(({ destino, volumen }) => [destino, volumen]))

  for (const [destino, etiqueta] of esperados) {
    if (!declarados.has(destino)) {
      problemas.push(
        `Falta el volumen de "${etiqueta}": el servicio "${SERVICIO}" no monta nada en ` +
          `"${destino}". Sin esa línea, el \`pnpm install\` del contenedor escribe sobre los ` +
          'node_modules del host y los deja inservibles sin que nada avise. Agrega ' +
          `\`- nm-<nombre>:${destino}\` a los volúmenes del servicio y declara ese nombre en el ` +
          'bloque `volumes:` de primer nivel.',
      )
    }
  }

  for (const [destino, volumen] of declarados) {
    if (!esperados.has(destino)) {
      problemas.push(
        `El volumen "${volumen}" monta "${destino}", que no corresponde a ningún paquete del ` +
          'workspace. Si el paquete se eliminó o se movió, quita o corrige la línea: un montaje ' +
          'que no tapa nada solo confunde a quien venga a revisar la lista.',
      )
    }
  }

  return problemas
}

const lineas = readFileSync(RUTA_COMPOSE, 'utf8').split(/\r?\n/)
const indice = indexarPaquetesDelWorkspace()
const esperados = montajesEsperados(indice)

let huboError = false

// --- Control positivo -------------------------------------------------------
// Borrar la línea de un paquete tiene que hacer fallar la comparación nombrando
// ese paquete. Se prueba con los doce, uno por uno: así no basta con que el
// script detecte "alguno", tiene que distinguirlos.
const { nombrados } = extraerMontajes(lineas)
let controlOk = true
if (nombrados.length === 0) {
  controlOk = false
  console.error('✗ Control positivo roto: no se pudo leer ningún montaje del compose.')
}
for (const { destino, indice: nroLinea } of nombrados) {
  const etiqueta = esperados.get(destino)
  if (!etiqueta) continue // un sobrante ya lo reporta la comparación real
  const mutiladas = lineas.filter((_, i) => i !== nroLinea)
  const problemas = comparar(mutiladas, esperados)
  const detecta = problemas.some((p) => p.includes(`"${etiqueta}"`))
  if (!detecta) {
    controlOk = false
    console.error(
      `✗ Control positivo roto: al quitar el montaje "${destino}" la comprobación no señaló a ` +
        `"${etiqueta}". Este guardián no distingue qué falta, así que no sirve.`,
    )
  }
}
if (!controlOk) huboError = true

// --- Comprobación real ------------------------------------------------------
const problemas = comparar(lineas, esperados)
for (const problema of problemas) {
  huboError = true
  console.error(`✗ ${problema}`)
}

// Un volumen con nombre que no esté declarado arriba hace fallar a Compose
// entero, y el mensaje de Compose no dice cuál falta.
const declaradosArriba = volumenesDeclarados(lineas)
for (const { volumen, destino } of nombrados) {
  if (!declaradosArriba.has(volumen)) {
    huboError = true
    console.error(
      `✗ El volumen "${volumen}" (${destino}) no está declarado en el bloque \`volumes:\` de ` +
        'primer nivel. Compose se niega a levantar nada hasta que lo esté.',
    )
  }
}

if (huboError) {
  console.error('\nLa comprobación de volúmenes falló. Ver arriba.')
  process.exit(1)
}

console.log(
  `Volúmenes de node_modules verificados: ${nombrados.length} montajes con nombre para ` +
    `${indice.size} paquetes del workspace más la raíz.`,
)
console.log(
  `Control positivo: quitar cualquiera de los ${nombrados.length} montajes hace fallar la ` +
    'comprobación nombrando ese paquete.',
)
process.exit(0)
