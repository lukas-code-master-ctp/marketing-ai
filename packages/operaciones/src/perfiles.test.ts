import { PERFIL_VALIDO, validarPerfil } from '@gc/brand'
import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  PLANTILLA_DE_PERFIL,
  cargarPerfilDeObjeto,
  estrategiaDelTrimestre,
  perfilConHistorial,
} from './perfiles.js'
import { sembrarConEstrategia, sembrarConGrilla } from './pruebas/siembra.js'

async function sembrar(db: Parameters<Parameters<typeof conBaseDeDatosDePrueba>[0]>[0]) {
  const [org] = await db.insert(esquema.organizations).values({ name: 'X', slug: 'x' }).returning()
  const [marca] = await db
    .insert(esquema.brands)
    .values({ organizationId: org!.id, slug: 'parcelas', name: 'CTP' })
    .returning()
  return { organizationId: org!.id, brandId: marca!.id }
}

describe('perfilConHistorial', () => {
  it('devuelve el perfil vigente y el historial de versiones', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      await cargarPerfilDeObjeto(db, ref.organizationId, { slug: 'parcelas', perfil: PERFIL_VALIDO })
      await cargarPerfilDeObjeto(db, ref.organizationId, {
        slug: 'parcelas',
        perfil: { ...PERFIL_VALIDO, ofertas: [] },
      })

      const r = await perfilConHistorial(db, ref.organizationId, 'parcelas')

      expect(r).not.toBeNull()
      expect(r!.version).toBe(2)
      expect(r!.versiones.map((v) => v.version)).toEqual([2, 1])
    })
  })

  it('perfilConHistorial devuelve null cuando la marca todavía no tiene perfil', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [org] = await db
        .insert(esquema.organizations)
        .values({ name: 'Principal', slug: 'principal' })
        .returning({ id: esquema.organizations.id })
      await db
        .insert(esquema.brands)
        .values({ organizationId: org!.id, slug: 'nueva', name: 'Nueva' })

      expect(await perfilConHistorial(db, org!.id, 'nueva')).toBeNull()
    })
  })
})

/**
 * Ya no la ve nadie desde el editor web —arranca el formulario vacío, no
 * esta plantilla—, así que sus dos exigencias hoy sirven a otra persona: al
 * CLI, que compara contra ella lo que llega por `perfil:cargar --archivo`.
 *
 * Valida contra el esquema: si dejara de cumplirlo, la comparación seguiría
 * corriendo pero dejaría de proteger nada, y nada más lo notaría —nada del
 * camino de ejecución llama a `validarPerfil(PLANTILLA_DE_PERFIL)`—. Eso se
 * afirma contra `validarPerfil` directo, que es la puerta por la que pasa, y
 * no guardándola —guardarla ya no se puede—.
 *
 * Y no se guarda sin tocar: desde ahí P1 y P2 le pasan al modelo un contexto
 * de marca de relleno, con los pilares al 50/50, y la salida no se ve rota
 * sino vacía. Esa corrida cuesta una llamada real al modelo.
 */
describe('PLANTILLA_DE_PERFIL', () => {
  it('cumple el esquema, para que un cambio en el esquema no la deje desincronizada en silencio', () => {
    expect(() => validarPerfil(PLANTILLA_DE_PERFIL)).not.toThrow()
  })

  it('no se puede guardar sin tocar, y no deja ninguna versión', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)

      const error = await cargarPerfilDeObjeto(db, ref.organizationId, {
        slug: 'parcelas',
        perfil: PLANTILLA_DE_PERFIL,
      }).catch((e: unknown) => e)

      expect(error).toMatchObject({ clase: 'permanente' })
      expect((error as Error).message).toMatch(/plantilla/i)
      expect((error as Error).message).toMatch(/reemplaza/i)
      expect(await perfilConHistorial(db, ref.organizationId, 'parcelas')).toBeNull()
    })
  })

  // El editor es un textarea de JSON crudo: la persona reordena claves sin
  // querer con solo mover un bloque. Comparar por `JSON.stringify` habría
  // dejado pasar eso, que no cambia un solo texto de relleno.
  it('tampoco se guarda con las claves en otro orden', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const { posicionamiento, publicos, ...resto } = PLANTILLA_DE_PERFIL
      const reordenada = { ...resto, publicos, posicionamiento }

      await expect(
        cargarPerfilDeObjeto(db, ref.organizationId, { slug: 'parcelas', perfil: reordenada }),
      ).rejects.toMatchObject({ clase: 'permanente' })
    })
  })

  // El control positivo: sin él, la comparación podría rechazar cualquier
  // perfil y las tres pruebas de arriba pasarían igual.
  it('con un solo campo reemplazado sí se guarda, y queda como la versión 1', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const editada = {
        ...PLANTILLA_DE_PERFIL,
        posicionamiento: {
          ...PLANTILLA_DE_PERFIL.posicionamiento,
          promesa: 'Tu parcela de agrado, sin sorpresas en la escritura',
        },
      }

      const version = await cargarPerfilDeObjeto(db, ref.organizationId, {
        slug: 'parcelas',
        perfil: editada,
      })

      expect(version).toBe(1)
      const guardado = await perfilConHistorial(db, ref.organizationId, 'parcelas')
      expect(guardado!.perfil).toEqual(editada)
    })
  })

  // La marca inexistente se resuelve antes que la plantilla: al revés, cargar
  // la plantilla contra un slug mal escrito respondía "reemplaza los textos"
  // y mandaba a buscar el problema al lugar equivocado.
  it('con una marca que no existe manda el error de la marca, no el de la plantilla', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)

      const error = await cargarPerfilDeObjeto(db, ref.organizationId, {
        slug: 'inventada',
        perfil: PLANTILLA_DE_PERFIL,
      }).catch((e: unknown) => e)

      expect((error as Error).message).toMatch(/no existe la marca/i)
    })
  })
})

describe('estrategiaDelTrimestre', () => {
  it('la estrategia del trimestre corresponde al mes', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db) // crea 2026-Q3

      const deSeptiembre = await estrategiaDelTrimestre(db, ref.organizationId, 'parcelas', '2026-09')
      expect(deSeptiembre.tipo).toBe('ok')
      expect(deSeptiembre.periodo).toBe('2026-Q3')

      // Antes esto devolvía `null`; ahora "no hay" es un caso de la unión que
      // además nombra el trimestre que se buscó.
      expect(await estrategiaDelTrimestre(db, ref.organizationId, 'parcelas', '2026-12'))
        .toEqual({ tipo: 'ausente', periodo: '2026-Q4' })
    })
  })

  it('estrategiaDelTrimestre marca como inválida una estrategia corrupta, en vez de devolverla cruda', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConGrilla(db)
      await db
        .update(esquema.strategies)
        .set({ data: { objetivos: 'esto no es un arreglo' } })
        .where(eq(esquema.strategies.brandId, ref.brandId))

      const r = await estrategiaDelTrimestre(db, ref.organizationId, 'parcelas', '2026-09')

      expect(r.tipo).toBe('invalida')
      if (r.tipo !== 'invalida') throw new Error('inalcanzable')
      expect(r.periodo).toBe('2026-Q3')
    })
  })

  it('estrategiaDelTrimestre sí devuelve una archivada, con su estado', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConGrilla(db)
      await db
        .update(esquema.strategies)
        .set({ status: 'archivada' })
        .where(eq(esquema.strategies.brandId, ref.brandId))

      const r = await estrategiaDelTrimestre(db, ref.organizationId, 'parcelas', '2026-09')

      expect(r.tipo).toBe('ok')
      if (r.tipo !== 'ok') throw new Error('inalcanzable')
      expect(r.estado).toBe('archivada')
    })
  })
})
