import { ClienteFalso } from '@gc/ai'
import { PERFIL_VALIDO, guardarPerfil } from '@gc/brand'
import { esquema, type BaseDeDatos } from '@gc/db'
import { ejecutarFlujo } from '@gc/pipeline'
import { crearFlujoGrilla } from '@gc/strategy'

const SIN_ESPERA = { dormir: async () => {}, aleatorio: () => 0 }
const ENV = { MODELO_RAZONAMIENTO: 'proveedor/fuerte' }

/** Organización, marca `parcelas`, perfil y estrategia de 2026-Q3. */
export async function sembrarConEstrategia(db: BaseDeDatos) {
  const [org] = await db
    .insert(esquema.organizations)
    .values({ name: 'Principal', slug: 'principal' })
    .returning()
  const [marca] = await db
    .insert(esquema.brands)
    .values({ organizationId: org!.id, slug: 'parcelas', name: 'CTP' })
    .returning()
  const ref = { organizationId: org!.id, brandId: marca!.id }
  await guardarPerfil(db, ref, PERFIL_VALIDO)

  await db.insert(esquema.strategies).values({
    organizationId: ref.organizationId,
    brandId: ref.brandId,
    period: '2026-Q3',
    brandProfileVersion: 1,
    data: {
      objetivos: [{ nombre: 'Alcance', metrica: 'alcance', meta: '+10%' }],
      mensajesClave: ['mensaje uno largo', 'mensaje dos largo'],
      mixDeCanales: [
        { canal: 'blog', publicacionesPorSemana: 1 },
        { canal: 'linkedin', publicacionesPorSemana: 1 },
        { canal: 'instagram', publicacionesPorSemana: 1 },
      ],
      reciclaje: [{ desde: 'blog', hacia: ['linkedin', 'instagram'], diasDespues: 2 }],
      temasPrioritarios: ['factibilidad de agua'],
    },
  })

  return ref
}

/** Lo anterior más la grilla de 2026-09 ya generada: 4 artículos y 8 derivados. */
export async function sembrarConGrilla(db: BaseDeDatos) {
  const ref = await sembrarConEstrategia(db)

  const slot = (fecha: string, pilar: string) => ({
    fecha, hora: '13:00', canal: 'blog', formato: 'articulo', pilar,
    angulo: 'guía práctica',
    brief: 'Explicar paso a paso cómo verificar la factibilidad antes de comprar.',
  })
  const grilla = JSON.stringify({
    slots: [
      slot('2026-09-02', 'educacion'), slot('2026-09-09', 'educacion'),
      slot('2026-09-16', 'confianza'), slot('2026-09-23', 'producto'),
    ],
  })

  const flujo = crearFlujoGrilla({ cliente: new ClienteFalso([grilla]), env: ENV })
  await ejecutarFlujo(db, flujo, { brandId: ref.brandId, mes: '2026-09' }, ref, SIN_ESPERA)

  return ref
}
