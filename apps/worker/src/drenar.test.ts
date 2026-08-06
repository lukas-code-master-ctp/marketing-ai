import { ClienteFalso } from '@gc/ai'
import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { encolarGrilla } from '@gc/operaciones'
import { sembrarConEstrategia } from '@gc/operaciones/pruebas'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { drenarCola } from './drenar.js'

const ENV = { MODELO_RAZONAMIENTO: 'proveedor/fuerte' }

/** Mismo mes de 2026-Q3 que usa `tomar.test.ts`: la siembra trae esa estrategia. */
const MES = '2026-09'

const GRILLA = JSON.stringify({
  slots: [
    {
      fecha: '2026-09-02', hora: '13:00', canal: 'blog', formato: 'articulo',
      pilar: 'educacion', angulo: 'guía práctica',
      brief: 'Explicar paso a paso cómo verificar la factibilidad antes de comprar.',
    },
  ],
})

describe('drenarCola', () => {
  it('con la cola vacía devuelve cero y no dice que quede trabajo', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const r = await drenarCola(db, { cliente: new ClienteFalso([]), env: ENV })
      expect(r).toEqual({ completadas: 0, fallidas: 0, quedaTrabajo: false })
    })
  })

  it('atiende todas las corridas pendientes en un solo turno', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      // Tres marcas distintas: `encolar` rechaza una segunda corrida viva para
      // la misma marca y mes, así que encolar tres veces sobre `parcelas` no
      // daría tres corridas y esta prueba mediría otra cosa.
      await db.insert(esquema.brands).values([
        { organizationId: ref.organizationId, slug: 'dos', name: 'Dos' },
        { organizationId: ref.organizationId, slug: 'tres', name: 'Tres' },
      ])
      await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: MES })
      await encolarGrilla(db, ref.organizationId, { slug: 'dos', mes: MES })
      await encolarGrilla(db, ref.organizationId, { slug: 'tres', mes: MES })

      // Solo `parcelas` tiene estrategia sembrada, así que las otras dos
      // fallan en el primer paso sin llamar al modelo. Lo que esta prueba
      // afirma es que el drenado no se detiene: las tres se atienden.
      const r = await drenarCola(db, { cliente: new ClienteFalso([GRILLA]), env: ENV })

      expect(r.completadas + r.fallidas).toBe(3)
      expect(r.quedaTrabajo).toBe(false)
      const pendientes = await db
        .select()
        .from(esquema.pipelineRuns)
        .where(eq(esquema.pipelineRuns.status, 'pendiente'))
      expect(pendientes).toHaveLength(0)
    })
  })

  it('una corrida que falla no detiene a las siguientes', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      // Una sola marca alcanza: la guarda contra el doble encolado es por
      // marca **y mes**, así que dos meses distintos dan dos corridas vivas.
      // La primera en entrar es la que falla: sin estrategia para 2026-Q4.
      await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })
      await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: MES })

      const r = await drenarCola(db, { cliente: new ClienteFalso([GRILLA]), env: ENV })

      expect(r).toMatchObject({ completadas: 1, fallidas: 1, quedaTrabajo: false })
    })
  })

  it('al alcanzar el límite corta el turno y avisa que queda trabajo', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      await db.insert(esquema.brands).values({
        organizationId: ref.organizationId, slug: 'dos', name: 'Dos',
      })
      await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })
      await encolarGrilla(db, ref.organizationId, { slug: 'dos', mes: '2026-10' })

      const r = await drenarCola(db, { cliente: new ClienteFalso([]), env: ENV }, 1)

      // Sin el límite, este turno se llevaría las dos. Con él se lleva una y
      // deja constancia de que hay más, que es lo que permite a quien llame
      // volver a pedir en vez de creer que la cola quedó vacía.
      expect(r).toMatchObject({ fallidas: 1, quedaTrabajo: true })
      const pendientes = await db
        .select()
        .from(esquema.pipelineRuns)
        .where(eq(esquema.pipelineRuns.status, 'pendiente'))
      expect(pendientes).toHaveLength(1)
    })
  })
})
