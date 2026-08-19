import { ClienteFalso } from '@gc/ai'
import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { encolarGrilla } from '@gc/operaciones'
import { sembrarConEstrategia } from '@gc/operaciones/pruebas'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { drenarCola } from './drenar.js'

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
      const r = await drenarCola(db, { cliente: new ClienteFalso([]) })
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
      const r = await drenarCola(db, { cliente: new ClienteFalso([GRILLA]) })

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

      const r = await drenarCola(db, { cliente: new ClienteFalso([GRILLA]) })

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

      const r = await drenarCola(db, { cliente: new ClienteFalso([]) }, 1)

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

  it('una señal de apagado corta el turno y deja el resto en pendiente', async () => {
    // El límite por cantidad no alcanza para acotar un turno: diez corridas
    // pueden tardar más que el tiempo de espera de Cloud Run, y allá el
    // drenado ocurre **dentro** de la petición, así que un SIGTERM no podía
    // acortarlo de ninguna forma — el proceso seguía tomando corridas nuevas
    // hasta que lo mataran. Lo que esta prueba afirma es que la señal se mira
    // entre corrida y corrida, que es el único punto donde cortar es
    // inofensivo: la corrida que ya empezó termina, y las que no empezaron
    // quedan `pendiente` para que la red de seguridad las levante.
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      await db.insert(esquema.brands).values({
        organizationId: ref.organizationId, slug: 'dos', name: 'Dos',
      })
      await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })
      await encolarGrilla(db, ref.organizationId, { slug: 'dos', mes: '2026-10' })

      // Se enciende después de la primera consulta, para que el turno atienda
      // una corrida y corte antes de la segunda. Si `drenarCola` no mirara la
      // bandera, se llevaría las dos y no quedaría ninguna pendiente.
      let señal = false
      const debeParar = () => {
        const antes = señal
        señal = true
        return antes
      }

      const r = await drenarCola(db, { cliente: new ClienteFalso([]) }, { debeParar })

      expect(r).toMatchObject({ completadas: 0, fallidas: 1, quedaTrabajo: true })
      const pendientes = await db
        .select()
        .from(esquema.pipelineRuns)
        .where(eq(esquema.pipelineRuns.status, 'pendiente'))
      expect(pendientes).toHaveLength(1)
    })
  })

  it('agotado el presupuesto de tiempo el turno corta y deja el resto en la cola', async () => {
    // El presupuesto se cuenta **desde que arranca el turno**, así que con un
    // milisegundo la primera corrida sí se atiende: la condición se comprueba
    // antes de cada una, y al entrar no ha pasado tiempo todavía. El corte
    // llega antes de la segunda, que es lo que esta prueba mide.
    //
    // Que atienda al menos una es lo correcto y no un defecto: un turno que
    // cortara sin hacer nada no serviría para nada, y el motivo del corte
    // —Cloud Run cortando la petición a mitad de una generación— solo aparece
    // a partir de la segunda.
    //
    // Las dos corridas van a meses de 2026-Q4, que `sembrarConEstrategia` no
    // cubre, así que fallan en el primer paso sin llamar al modelo: lo que se
    // mide acá es el corte, no lo que hace cada corrida.
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })
      await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-11' })

      const r = await drenarCola(
        db,
        { cliente: new ClienteFalso([]) },
        { presupuestoMs: 1 },
      )

      expect(r).toEqual({ completadas: 0, fallidas: 1, quedaTrabajo: true })
      const pendientes = await db
        .select()
        .from(esquema.pipelineRuns)
        .where(eq(esquema.pipelineRuns.status, 'pendiente'))
      expect(pendientes).toHaveLength(1)
    })
  })

  it('un límite o un presupuesto no positivos son un error de quien llama', async () => {
    // Sin la guarda, el bucle no daba ni una vuelta y la función devolvía
    // `quedaTrabajo: true` —afirmando que queda trabajo **sin haber consultado
    // la cola**— más un log diciendo que el turno cortó por llegar al tope.
    await conBaseDeDatosDePrueba(async (db) => {
      const deps = { cliente: new ClienteFalso([]) }
      await expect(drenarCola(db, deps, 0)).rejects.toThrow(/límite=0/)
      await expect(drenarCola(db, deps, { presupuestoMs: 0 })).rejects.toThrow(/presupuesto=0/)
    })
  })
})
