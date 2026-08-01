import { resolverDesdeInvocacion } from './entorno.js'
import { crearCliente } from '@gc/ai'
import { crearConexion } from '@gc/db'
import { parseArgs } from 'node:util'
import {
  cargarPerfilDeArchivo, crearMarca, generarEstrategia, generarGrilla, resolverOrganizacion, verGrilla,
} from './comandos.js'

const AYUDA = `
Uso: pnpm cli <comando> [opciones]

Comandos:
  marca:crear         --slug <slug> --nombre <nombre> [--presupuesto <usd>]
  perfil:cargar       --marca <slug> --archivo <ruta.json>
  estrategia:generar  --marca <slug> --periodo <2026-Q4>
  grilla:generar      --marca <slug> --mes <2026-09>
  grilla:ver          --marca <slug> --mes <2026-09>

Opciones globales:
  --seco              usa las muestras locales y no gasta tokens
  --org <slug>        elige la organización cuando hay más de una
`

const COMANDOS = new Set([
  'marca:crear', 'perfil:cargar', 'estrategia:generar', 'grilla:generar', 'grilla:ver',
])

async function principal(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      slug: { type: 'string' },
      nombre: { type: 'string' },
      presupuesto: { type: 'string' },
      marca: { type: 'string' },
      archivo: { type: 'string' },
      periodo: { type: 'string' },
      mes: { type: 'string' },
      seco: { type: 'boolean', default: false },
      org: { type: 'string' },
    },
  })

  const comando = positionals[0]
  if (!comando || !COMANDOS.has(comando)) {
    console.log(AYUDA)
    return
  }

  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Falta DATABASE_URL')

  const env = values.seco ? { ...process.env, IA_EN_SECO: 'true' } : process.env
  // Las rutas del entorno y de la línea de comandos son relativas a donde el
  // usuario está parado, no a apps/cli.
  const opcionesDeCliente = {
    env,
    ...(env.CARPETA_DE_MUESTRAS !== undefined
      ? { carpetaDeMuestras: resolverDesdeInvocacion(env.CARPETA_DE_MUESTRAS) }
      : {}),
  }
  const { db, cerrar } = crearConexion(url)

  try {
    const organizationId = await resolverOrganizacion(db, {
      ...(values.org !== undefined ? { org: values.org } : {}),
      env,
    })

    switch (comando) {
      case 'marca:crear': {
        const ref = await crearMarca(db, organizationId, {
          slug: exigir(values.slug, '--slug'),
          nombre: exigir(values.nombre, '--nombre'),
          ...(values.presupuesto !== undefined ? { presupuesto: values.presupuesto } : {}),
        })
        console.log(`Marca creada: ${ref.brandSlug ?? ref.brandId}`)
        break
      }
      case 'perfil:cargar': {
        const version = await cargarPerfilDeArchivo(db, organizationId, {
          slug: exigir(values.marca, '--marca'),
          archivo: resolverDesdeInvocacion(exigir(values.archivo, '--archivo')),
        })
        console.log(`Perfil guardado como versión ${version}`)
        break
      }
      case 'estrategia:generar': {
        const r = await generarEstrategia(db, crearCliente(opcionesDeCliente), organizationId, {
          slug: exigir(values.marca, '--marca'),
          periodo: exigir(values.periodo, '--periodo'),
          env,
        })
        console.log(`Estrategia ${r.strategyId} generada en borrador`)
        break
      }
      case 'grilla:generar': {
        const r = await generarGrilla(db, crearCliente(opcionesDeCliente), organizationId, {
          slug: exigir(values.marca, '--marca'),
          mes: exigir(values.mes, '--mes'),
          env,
        })
        console.log(`Grilla ${r.contentPlanId}: ${r.totalSlots} publicaciones`)
        for (const a of r.avisos) console.log(`  aviso [${a.regla}] ${a.detalle}`)
        break
      }
      case 'grilla:ver': {
        const filas = await verGrilla(db, organizationId, {
          slug: exigir(values.marca, '--marca'),
          mes: exigir(values.mes, '--mes'),
        })
        console.table(filas)
        break
      }
    }
  } finally {
    await cerrar()
  }
}

function exigir(valor: string | undefined, bandera: string): string {
  if (!valor) throw new Error(`Falta la opción obligatoria ${bandera}`)
  return valor
}

try {
  await principal()
} catch (error) {
  // El CLI es superficie humana: los mensajes ya están en español y explican
  // qué hacer, pero sin esto salen enterrados en un stack trace.
  console.error(`\nError: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
