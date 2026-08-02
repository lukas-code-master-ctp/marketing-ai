import { PERFIL_VALIDO } from '@gc/brand'
import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { cargarPerfilDeObjeto } from './perfiles.js'
import {
  aprobarGrilla, descartarSlot, editarSlot, grillaDelMes, reabrirGrilla,
} from './grilla.js'
import { sembrarConEstrategia, sembrarConGrilla } from './pruebas/siembra.js'

describe('grillaDelMes', () => {
  it('devuelve el mes vacío cuando no hay plan', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const g = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-10')

      expect(g.contentPlanId).toBeNull()
      expect(g.estado).toBeNull()
      expect(g.slots).toEqual([])
      expect(g.problemas).toEqual([])
    })
  })

  it('marca los derivados y su padre', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConGrilla(db)
      const g = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')

      expect(g.slots).toHaveLength(12)

      const derivados = g.slots.filter((s) => s.esDerivado)
      expect(derivados).toHaveLength(8)
      for (const d of derivados) {
        const padre = g.slots.find((s) => s.id === d.idDelPadre)
        expect(padre).toBeDefined()
        expect(padre!.esDerivado).toBe(false)
      }
    })
  })

  it('ordena los slots por fecha y hora ascendente, padres y derivados entreverados', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConGrilla(db)
      const g = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')

      expect(g.slots).toHaveLength(12)

      // Los 4 artículos se insertan primero (un solo insert) y los 8
      // derivados después (otro insert), agrupados por padre. Esa es la
      // fecha en que Postgres los guarda, pero NO es el orden cronológico:
      // los derivados del primer artículo (2 días después) caen antes que
      // el segundo artículo. Si `grillaDelMes` no ordenara explícitamente,
      // el resultado más probable sería el de inserción —padres, luego
      // derivados— y esta comparación lo detectaría.
      const claves = g.slots.map((s) => `${s.fecha}T${s.hora}`)
      const ordenadas = [...claves].sort()
      expect(claves).toEqual(ordenadas)

      // Y no es una comparación vacía: hay al menos un derivado intercalado
      // entre dos padres, exactamente lo que el calendario necesita ver.
      const primerIndiceDeDerivado = g.slots.findIndex((s) => s.esDerivado)
      const ultimoIndiceDePadre = g.slots.map((s) => s.esDerivado).lastIndexOf(false)
      expect(primerIndiceDeDerivado).toBeLessThan(ultimoIndiceDePadre)
    })
  })

  it('no cuenta los descartados en el resumen por canal', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConGrilla(db)
      const antes = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')
      const unBlog = antes.slots.find((s) => s.canal === 'blog')!

      await db
        .update(esquema.planSlots)
        .set({ status: 'descartado' })
        .where(eq(esquema.planSlots.id, unBlog.id))

      const despues = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')

      // Sigue apareciendo, marcado, pero deja de contar.
      expect(despues.slots).toHaveLength(12)
      expect(despues.slots.find((s) => s.id === unBlog.id)!.descartado).toBe(true)
      expect(despues.porCanal['blog']).toBe(antes.porCanal['blog']! - 1)
    })
  })

  it('recalcula los avisos sobre los slots vigentes, no sobre los originales', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConGrilla(db)
      const antes = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')

      // Descartar todos los de un canal cambia su cadencia.
      await db
        .update(esquema.planSlots)
        .set({ status: 'descartado' })
        .where(eq(esquema.planSlots.channel, 'blog'))

      const despues = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')

      const cadenciaBlogAntes = antes.problemas.filter(
        (a) => a.regla === 'cadencia' && a.detalle.includes('blog'),
      )
      const cadenciaBlogDespues = despues.problemas.filter(
        (a) => a.regla === 'cadencia' && a.detalle.includes('blog'),
      )
      expect(cadenciaBlogDespues.length).toBeGreaterThan(cadenciaBlogAntes.length)
    })
  })

  it('devuelve los bloqueantes, no solo los avisos', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConGrilla(db)
      expect(
        (await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')).problemas
          .some((p) => p.severidad === 'bloqueante'),
      ).toBe(false)

      // Renombrar un pilar es una edición legal y validada del perfil, y deja
      // a todos los slots que lo usaban con `pilar_desconocido`: un problema
      // bloqueante alcanzable desde la propia interfaz. Filtrarlo dejaba la
      // pantalla mostrando solo el síntoma —los avisos de distribución de los
      // pilares nuevos— y tirando el diagnóstico.
      await cargarPerfilDeObjeto(db, ref.organizationId, {
        slug: 'parcelas',
        perfil: {
          ...PERFIL_VALIDO,
          pilares: [
            { nombre: 'formacion', descripcion: 'Cómo evaluar una parcela', proporcion: 0.4 },
            { nombre: 'confianza', descripcion: 'Casos y respaldo legal', proporcion: 0.35 },
            { nombre: 'producto', descripcion: 'Proyectos disponibles', proporcion: 0.25 },
          ],
        },
      })

      const g = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')
      const bloqueantes = g.problemas.filter((p) => p.severidad === 'bloqueante')
      expect(bloqueantes.length).toBeGreaterThan(0)
      expect(bloqueantes.every((p) => p.regla === 'pilar_desconocido')).toBe(true)
      expect(g.problemas.some((p) => p.severidad === 'aviso')).toBe(true)
    })
  })

  it('distingue "no hay estrategia" de "la estrategia guardada no valida"', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConGrilla(db)

      // Sin estrategia del trimestre no hay contra qué recalcular y la grilla
      // igual debe verse: nada que reportar.
      await db.delete(esquema.strategies).where(eq(esquema.strategies.brandId, ref.brandId))
      const sinEstrategia = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')
      expect(sinEstrategia.slots).toHaveLength(12)
      expect(sinEstrategia.problemas).toEqual([])

      // Con una estrategia guardada que no valida, en cambio, hay corrupción
      // de datos y la pantalla tiene que decirlo, no callar.
      await db.insert(esquema.strategies).values({
        organizationId: ref.organizationId,
        brandId: ref.brandId,
        period: '2026-Q3',
        brandProfileVersion: 1,
        data: { objetivos: 'esto no es una estrategia' },
      })

      const corrupta = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')
      expect(corrupta.slots).toHaveLength(12)
      expect(corrupta.problemas).toHaveLength(1)
      expect(corrupta.problemas[0]!.severidad).toBe('bloqueante')
      expect(corrupta.problemas[0]!.detalle).toContain('2026-Q3')
    })
  })
})

describe('descartarSlot, editarSlot y aprobarGrilla', () => {
  it('descartar deja el slot pero lo saca de los vigentes', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConGrilla(db)
      const g = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')
      const slot = g.slots.find((s) => !s.esDerivado)!

      await descartarSlot(db, ref.organizationId, slot.id)

      const despues = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')
      expect(despues.slots).toHaveLength(12)
      expect(despues.slots.find((s) => s.id === slot.id)!.descartado).toBe(true)
    })
  })

  it('descartar un padre NO descarta sus derivados', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConGrilla(db)
      const g = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')
      const padre = g.slots.find((s) => !s.esDerivado)!

      await descartarSlot(db, ref.organizationId, padre.id)

      // La cascada de la base gobierna el borrado, no el cambio de estado.
      // Es deliberado: la interfaz lo advierte y ofrece descartarlos aparte.
      const despues = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')
      const hijos = despues.slots.filter((s) => s.idDelPadre === padre.id)
      expect(hijos.length).toBeGreaterThan(0)
      expect(hijos.every((h) => !h.descartado)).toBe(true)
    })
  })

  it('editar cambia ángulo y brief y nada más', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConGrilla(db)
      const g = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')
      const slot = g.slots[0]!

      await editarSlot(db, ref.organizationId, slot.id, {
        angulo: 'Otro ángulo',
        brief: 'Un brief nuevo, suficientemente largo para ser creíble.',
      })

      const despues = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')
      const actualizado = despues.slots.find((s) => s.id === slot.id)!
      expect(actualizado.angulo).toBe('Otro ángulo')
      expect(actualizado.brief).toContain('suficientemente largo')
      expect(actualizado.canal).toBe(slot.canal)
      expect(actualizado.fecha).toBe(slot.fecha)
    })
  })

  it('editar rechaza lo que el esquema de dominio nunca habría generado', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConGrilla(db)
      const g = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')
      const slot = g.slots[0]!

      // Las columnas son NOT NULL sin CHECK: sin validación en `editarSlot`,
      // la cadena vacía persiste y queda un slot que la generación jamás
      // habría podido producir.
      await expect(
        editarSlot(db, ref.organizationId, slot.id, { angulo: '', brief: '' }),
      ).rejects.toMatchObject({ clase: 'permanente' })

      // Ángulo suficiente, brief por debajo del mínimo: la regla que falla se
      // nombra, no se devuelve un genérico.
      const error = await editarSlot(db, ref.organizationId, slot.id, {
        angulo: 'un ángulo creíble',
        brief: 'muy corto',
      }).catch((e: unknown) => e)
      expect(error).toMatchObject({ clase: 'permanente' })
      expect((error as Error).message).toContain('brief')

      const despues = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')
      const intacto = despues.slots.find((s) => s.id === slot.id)!
      expect(intacto.angulo).toBe(slot.angulo)
      expect(intacto.brief).toBe(slot.brief)
    })
  })

  it('aprobar mueve el plan a aprobada', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConGrilla(db)
      const g = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')

      await aprobarGrilla(db, ref.organizationId, g.contentPlanId!)

      const despues = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')
      expect(despues.estado).toBe('aprobada')
    })
  })

  it('aprobar una grilla que ya no está en borrador falla', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConGrilla(db)
      const g = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')
      await aprobarGrilla(db, ref.organizationId, g.contentPlanId!)

      await expect(
        aprobarGrilla(db, ref.organizationId, g.contentPlanId!),
      ).rejects.toMatchObject({ clase: 'permanente' })
    })
  })

  it('no deja descartar ni editar slots de una grilla que salió de borrador', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConGrilla(db)
      const g = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')
      await aprobarGrilla(db, ref.organizationId, g.contentPlanId!)

      // El motor (`p2.ts`) se niega a tocar nada que no esté en borrador
      // porque regenerar destruiría planificación ya revisada. La web escribía
      // en la misma tabla sin esa condición: se aprobaba septiembre y después
      // se le descartaban slots y se le reescribían briefs, con el plan
      // marcado "aprobada" y sin rastro del cambio.
      const slot = g.slots[0]!

      const alDescartar = await descartarSlot(db, ref.organizationId, slot.id)
        .catch((e: unknown) => e)
      expect(alDescartar).toMatchObject({ clase: 'permanente' })
      expect((alDescartar as Error).message).toContain('aprobada')

      const alEditar = await editarSlot(db, ref.organizationId, slot.id, {
        angulo: 'un ángulo creíble',
        brief: 'Un brief nuevo, suficientemente largo para ser creíble.',
      }).catch((e: unknown) => e)
      expect(alEditar).toMatchObject({ clase: 'permanente' })
      expect((alEditar as Error).message).toContain('aprobada')

      const despues = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')
      const intacto = despues.slots.find((s) => s.id === slot.id)!
      expect(intacto.descartado).toBe(false)
      expect(intacto.angulo).toBe(slot.angulo)
      expect(intacto.brief).toBe(slot.brief)
    })
  })

  it('reabrir devuelve una grilla aprobada a borrador y la vuelve editable', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConGrilla(db)
      const g = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')
      await aprobarGrilla(db, ref.organizationId, g.contentPlanId!)

      await reabrirGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-09' })

      const despues = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')
      expect(despues.estado).toBe('borrador')

      // Y no es solo la etiqueta: el remedio que `p2.ts` viene indicando
      // desde siempre ahora existe de verdad y devuelve la edición.
      await descartarSlot(db, ref.organizationId, g.slots[0]!.id)
    })
  })

  it('reabrir solo acepta una grilla aprobada', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConGrilla(db)

      const enBorrador = await reabrirGrilla(db, ref.organizationId, {
        slug: 'parcelas', mes: '2026-09',
      }).catch((e: unknown) => e)
      expect(enBorrador).toMatchObject({ clase: 'permanente' })
      expect((enBorrador as Error).message).toContain('borrador')

      await db
        .update(esquema.contentPlans)
        .set({ status: 'cerrada' })
        .where(eq(esquema.contentPlans.brandId, ref.brandId))

      const cerrada = await reabrirGrilla(db, ref.organizationId, {
        slug: 'parcelas', mes: '2026-09',
      }).catch((e: unknown) => e)
      expect(cerrada).toMatchObject({ clase: 'permanente' })
      expect((cerrada as Error).message).toContain('cerrada')
    })
  })

  it('reabrir un mes sin grilla lo dice, y no toca las de otra organización', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConGrilla(db)
      const g = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')
      await aprobarGrilla(db, ref.organizationId, g.contentPlanId!)

      await expect(
        reabrirGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' }),
      ).rejects.toMatchObject({ clase: 'permanente' })

      const [otra] = await db
        .insert(esquema.organizations)
        .values({ name: 'Ajena', slug: 'ajena' })
        .returning()
      await expect(
        reabrirGrilla(db, otra!.id, { slug: 'parcelas', mes: '2026-09' }),
      ).rejects.toMatchObject({ clase: 'permanente' })

      expect((await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')).estado)
        .toBe('aprobada')
    })
  })

  it('las tres operaciones ignoran filas de otra organización', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConGrilla(db)
      const g = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')
      const [otra] = await db
        .insert(esquema.organizations)
        .values({ name: 'Ajena', slug: 'ajena' })
        .returning()

      await expect(
        descartarSlot(db, otra!.id, g.slots[0]!.id),
      ).rejects.toMatchObject({ clase: 'permanente' })
      await expect(
        editarSlot(db, otra!.id, g.slots[0]!.id, {
          angulo: 'Ángulo ajeno', brief: 'Un brief que no debería aplicarse jamás.',
        }),
      ).rejects.toMatchObject({ clase: 'permanente' })
      await expect(
        aprobarGrilla(db, otra!.id, g.contentPlanId!),
      ).rejects.toMatchObject({ clase: 'permanente' })
    })
  })
})
