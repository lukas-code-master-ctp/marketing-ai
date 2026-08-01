# Decisiones previas a la Fase 1 — Plan de implementación

> **Para trabajadores agénticos:** SUB-SKILL REQUERIDA: usa `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para implementar este plan tarea por tarea. Los pasos usan sintaxis de casilla (`- [ ]`) para seguimiento.

**Goal:** Cerrar las tres decisiones tomadas antes de que la UI de Fase 1 las vuelva caras: borrar un slot deja de llevarse sus derivados, los mensajes nombran la marca por su slug, y un fallo de base deja de reejecutar llamadas al modelo ya pagadas.

**Architecture:** Una migración de una restricción. Los flujos P1 y P2 se parten en dos pasos cada uno — modelo y persistencia — apoyándose en la idempotencia por paso que el motor ya tiene. `ContextoDePaso` gana un `brandSlug` opcional que llega hasta los mensajes.

**Tech Stack:** TypeScript 5 (ESM), Node 22+, pnpm workspaces, PostgreSQL 16, Drizzle ORM, Zod v3, Vitest.

**Spec:** [pendientes.md](../specs/pendientes.md), sección "Prioridad 1 — decidido, listo para implementar".

## Global Constraints

- Node 22+; ESM (`"type": "module"`).
- Esquema y columnas en inglés `snake_case`; API de dominio, variables, comentarios y mensajes al usuario en **español**.
- **Ejecutar la suite completa con `pnpm test` desde la raíz**, nunca `pnpm -r test`. Un paquete suelto: `pnpm --filter @gc/<nombre> test`.
- **Una migración aplicada es inmutable.** Un error se corrige con otra migración, jamás editando la anterior.
- Las migraciones nuevas van **sin** el envoltorio `DO $$ ... EXCEPTION WHEN duplicate_object`: una migración que se salta en silencio es peor que una que falla.
- **Estado inicial: 206 pruebas en verde, 7 paquetes, `pnpm -r typecheck` limpio.** Ninguna tarea puede terminar con menos.
- TDD estricto: ninguna implementación antes de tener su prueba fallando y haberla visto fallar.
- Commits en español con prefijo convencional.

---

### Task 1: Borrar un slot no se lleva sus derivados

**Files:**
- Modify: `packages/db/src/esquema.ts`
- Create: `packages/db/migraciones/0004_*.sql`
- Test: `packages/db/src/esquema.test.ts`

**Interfaces:**
- Produces: ningún símbolo nuevo. Cambia el contrato de la base: `plan_slots_source_org_fk` pasa de `ON DELETE CASCADE` a `NO ACTION`.

- [ ] **Step 1: Escribir las pruebas que fallan**

Agregar a `packages/db/src/esquema.test.ts`:

```ts
  it('impide borrar un slot que todavía tiene derivados', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const { planId, padreId } = await sembrarPadreConDerivado(db)

      await expect(
        db.delete(esquema.planSlots).where(eq(esquema.planSlots.id, padreId)),
      ).rejects.toThrow(/plan_slots_source_org_fk/)

      // El derivado sigue vivo: nada se perdió en silencio.
      expect(await db.select().from(esquema.planSlots)).toHaveLength(2)
      expect(planId).toBeTruthy()
    })
  })

  it('permite borrar el plan entero, padres y derivados en una sola sentencia', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const { planId } = await sembrarPadreConDerivado(db)

      // Es el camino que usa la regeneración de grilla: NO ACTION se verifica
      // al final de la sentencia, cuando los hijos ya se fueron.
      await db.delete(esquema.planSlots).where(eq(esquema.planSlots.contentPlanId, planId))

      expect(await db.select().from(esquema.planSlots)).toHaveLength(0)
    })
  })
```

y el helper, junto a los demás del archivo:

```ts
async function sembrarPadreConDerivado(db: BaseDeDatos) {
  const [org] = await db
    .insert(esquema.organizations)
    .values({ name: 'Cascada', slug: 'cascada' })
    .returning()
  const [marca] = await db
    .insert(esquema.brands)
    .values({ organizationId: org!.id, slug: 'c', name: 'C' })
    .returning()
  const [plan] = await db
    .insert(esquema.contentPlans)
    .values({ organizationId: org!.id, brandId: marca!.id, month: '2026-09-01' })
    .returning()

  const fila = (sourceSlotId: string | null, canal: 'blog' | 'linkedin', dia: string) => ({
    organizationId: org!.id,
    contentPlanId: plan!.id,
    sourceSlotId,
    scheduledFor: new Date(`2026-09-${dia}T13:00:00Z`),
    channel: canal,
    format: sourceSlotId ? 'derivado' : 'articulo',
    pillar: 'educacion',
    angle: 'x',
    brief: 'Un brief suficientemente largo para pasar la validación.',
  })

  const [padre] = await db.insert(esquema.planSlots).values(fila(null, 'blog', '03')).returning()
  await db.insert(esquema.planSlots).values(fila(padre!.id, 'linkedin', '05'))

  return { planId: plan!.id, padreId: padre!.id }
}
```

- [ ] **Step 2: Ejecutar y verificar que falla**

```bash
pnpm --filter @gc/db test
```

Esperado: FALLA la primera (hoy el borrado del padre **tiene éxito** y se lleva el derivado en cascada, así que `rejects` no se cumple). La segunda pasa desde ya — es el control de que el cambio no rompe la regeneración.

- [ ] **Step 3: Cambiar el esquema**

En `packages/db/src/esquema.ts`, en la clave `plan_slots_source_org_fk`, quitar el `.onDelete('cascade')`. `NO ACTION` es el comportamiento por omisión de Postgres y no se declara.

Agregar encima un comentario que explique la elección, porque no es obvia:

```ts
  // NO ACTION, no CASCADE ni RESTRICT. La regeneración borra padres y
  // derivados en una sola sentencia y NO ACTION se verifica al final de
  // ella, así que ese camino sigue funcionando; RESTRICT lo rompería por
  // verificarse de inmediato. Borrar un padre suelto sí falla: la UI
  // descarta con status = 'descartado' en vez de borrar.
```

- [ ] **Step 4: Generar la migración y revisarla**

```bash
pnpm --filter @gc/db migraciones:generar
```

La migración debe contener exactamente un `DROP CONSTRAINT` y un `ADD CONSTRAINT` para `plan_slots_source_org_fk`, sin `ON DELETE`. Si drizzle-kit emite el envoltorio `DO $$ ... EXCEPTION`, quítalo: una migración que se salta en silencio es lo que este proyecto ya decidió no aceptar.

Si aparece cualquier otro statement, **detente y repórtalo**: significa que el esquema derivó respecto de la base.

- [ ] **Step 5: Actualizar la prueba de catálogo**

La prueba de catálogo afirma el `pg_get_constraintdef` completo de las doce compuestas, así que va a fallar con la definición vieja. **Eso es la prueba haciendo su trabajo.** Actualiza la definición esperada de `plan_slots_source_org_fk` quitándole el `ON DELETE CASCADE`.

- [ ] **Step 6: Aplicar y ejecutar**

```bash
pnpm --filter @gc/db migraciones:aplicar && pnpm --filter @gc/db test
```

Esperado: PASA. `@gc/db` suma 2 pruebas.

- [ ] **Step 7: Suite completa y commit**

```bash
pnpm test && pnpm -r typecheck
```

```bash
git add -A && git commit -m "feat: borrar un slot ya no se lleva sus derivados en cascada"
```

---

### Task 2: P2 se parte en modelo y persistencia

**Files:**
- Modify: `packages/strategy/src/p2.ts`
- Test: `packages/strategy/src/p2.test.ts`

**Interfaces:**
- Consumes: `definirPaso`, `ejecutarFlujo` (`@gc/pipeline`)
- Produces: `crearFlujoGrilla` devuelve ahora un flujo de **dos** pasos, `proponer_grilla` y `persistir_grilla`. `SalidaP2` sigue siendo la salida del flujo (el motor devuelve la del último paso), así que **`generarGrilla` en el CLI no cambia**. Nuevo tipo interno `SalidaDeLaPropuesta`, no exportado.

- [ ] **Step 1: Escribir la prueba que falla**

Es la prueba que da sentido a toda la tarea: un fallo transitorio al persistir no debe volver a llamar al modelo.

Agregar a `packages/strategy/src/p2.test.ts`:

```ts
  it('reintentar tras un fallo al persistir no vuelve a llamar al modelo', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)

      // El cliente trae una sola respuesta: si el modelo se llamara dos veces,
      // ClienteFalso lanzaría permanente por quedarse sin respuestas.
      const cliente = new ClienteFalso([GRILLA_VALIDA])
      const flujo = crearFlujoGrilla({ cliente, env: ENV })

      // Un trigger que revienta el primer INSERT en plan_slots con un código
      // transitorio, y se desactiva solo para que el reintento pase.
      await db.execute(sql`
        create table if not exists fallo_una_vez (usado boolean not null default false);
        delete from fallo_una_vez;
        insert into fallo_una_vez values (false);
        create or replace function romper_una_vez() returns trigger as $$
        begin
          if (select not usado from fallo_una_vez limit 1) then
            update fallo_una_vez set usado = true;
            raise exception 'conexión perdida' using errcode = '08006';
          end if;
          return new;
        end $$ language plpgsql;
        create trigger t_romper before insert on plan_slots
          for each row execute function romper_una_vez();
      `)

      try {
        const r = await ejecutarFlujo(
          db, flujo, { brandId: ref.brandId, mes: '2026-09' }, ref,
          { dormir: async () => {}, aleatorio: () => 0 },
        )

        expect(r.estado).toBe('completado')
        // Lo que prueba la tarea: una sola llamada al modelo pese al reintento.
        expect(cliente.peticiones).toHaveLength(1)
        expect(await db.select().from(esquema.aiCalls)).toHaveLength(1)
        expect(await db.select().from(esquema.planSlots)).toHaveLength(8)
      } finally {
        await db.execute(sql`
          drop trigger if exists t_romper on plan_slots;
          drop function if exists romper_una_vez();
          drop table if exists fallo_una_vez;
        `)
      }
    })
  })
```

Agregar `sql` al import de `drizzle-orm` en el archivo de pruebas.

- [ ] **Step 2: Ejecutar y verificar que falla**

```bash
pnpm --filter @gc/strategy test p2
```

Esperado: FALLA. Con un solo paso, el reintento reejecuta todo y `ClienteFalso` se queda sin respuestas: el error será `ClienteFalso se quedó sin respuestas predefinidas`. Ese mensaje **es** la evidencia del defecto.

- [ ] **Step 3: Partir el paso**

En `packages/strategy/src/p2.ts`, `crearFlujoGrilla` pasa de un paso a dos. El corte va **entre la línea 118 y la 120** del archivo actual: todo lo que llama al modelo queda en el primero, todo lo determinístico más la escritura queda en el segundo.

Declarar el tipo que viaja entre ambos (interno, no exportado):

```ts
/** Lo que el paso del modelo le entrega al de persistencia. El perfil y la
 *  estrategia viajan inline: son JSON de todos modos, y así el segundo paso
 *  no vuelve a consultarlos ni puede leer una versión distinta. */
interface SalidaDeLaPropuesta {
  brandId: string
  mes: string
  strategyId: string
  slots: TipoSlotPropuesto[]
  estrategia: TipoEstrategia
  perfil: TipoPerfilDeMarca
}
```

**Paso 1, `proponer_grilla`** — `definirPaso<EntradaP2, SalidaDeLaPropuesta>`: conserva sin cambios el cuerpo actual desde la comprobación de estado hasta el final del bucle de reparación, y en vez de seguir, devuelve:

```ts
      return {
        brandId: entrada.brandId,
        mes: entrada.mes,
        strategyId,
        slots,
        estrategia,
        perfil,
      }
```

**Paso 2, `persistir_grilla`** — `definirPaso<SalidaDeLaPropuesta, SalidaP2>`: recibe eso y ejecuta lo que hoy son las líneas 120 a 152 — `expandirDerivados`, la revalidación del conjunto expandido con su `throw permanente`, `persistir`, y el `return` de `SalidaP2`. Donde el código actual usa `entrada.mes` o `entrada.brandId`, ahora los toma de su propia entrada; donde usa `perfil` o `estrategia`, también.

`persistir` recibe hoy `(ctx, entrada, strategyId, slots, derivados)`. Su segundo parámetro solo se usa por `brandId` y `mes`, así que el tipo de `SalidaDeLaPropuesta` lo satisface sin cambiarlo.

Finalmente:

```ts
  return { nombre: 'p2_grilla', pasos: [pasoProponer, pasoPersistir] }
```

`p2.ts` va a necesitar `import type { TipoPerfilDeMarca } from '@gc/brand'`, que hoy no está: el perfil solo se usaba como valor local y ahora aparece en la firma del tipo intermedio.

**Lo que no debe cambiar:** el contenido del bucle de reparación, el máximo de dos llamadas, la comprobación de estado dentro de la transacción de `persistir`, ni `SalidaP2`. Esta tarea mueve código, no lo reescribe.

- [ ] **Step 4: Ejecutar y verificar que pasa**

```bash
pnpm --filter @gc/strategy test p2
```

Esperado: PASA, incluida la prueba nueva y las siete existentes sin tocarlas.

- [ ] **Step 5: Suite completa y commit**

```bash
pnpm test && pnpm -r typecheck
```

```bash
git add -A && git commit -m "feat: P2 separa la llamada al modelo de la persistencia"
```

---

### Task 3: P1 se parte en modelo y persistencia

**Files:**
- Modify: `packages/strategy/src/p1.ts`
- Test: `packages/strategy/src/p1.test.ts`

**Interfaces:**
- Produces: `crearFlujoEstrategia` devuelve un flujo de dos pasos, `generar_estrategia` y `persistir_estrategia`. `SalidaP1` sigue siendo la salida del flujo, así que `generarEstrategia` en el CLI no cambia.

- [ ] **Step 1: Escribir la prueba que falla**

Agregar a `packages/strategy/src/p1.test.ts`, con el mismo trigger de un solo fallo que la Task 2 pero sobre `strategies`:

```ts
  it('reintentar tras un fallo al persistir no vuelve a llamar al modelo', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const cliente = new ClienteFalso([ESTRATEGIA_JSON])
      const flujo = crearFlujoEstrategia({ cliente, env: ENV })

      await db.execute(sql`
        create table if not exists fallo_una_vez (usado boolean not null default false);
        delete from fallo_una_vez;
        insert into fallo_una_vez values (false);
        create or replace function romper_una_vez() returns trigger as $$
        begin
          if (select not usado from fallo_una_vez limit 1) then
            update fallo_una_vez set usado = true;
            raise exception 'conexión perdida' using errcode = '08006';
          end if;
          return new;
        end $$ language plpgsql;
        create trigger t_romper before insert on strategies
          for each row execute function romper_una_vez();
      `)

      try {
        const r = await ejecutarFlujo(
          db, flujo, { brandId: ref.brandId, period: '2026-Q4' }, ref,
          { dormir: async () => {}, aleatorio: () => 0 },
        )

        expect(r.estado).toBe('completado')
        expect(cliente.peticiones).toHaveLength(1)
        expect(await db.select().from(esquema.aiCalls)).toHaveLength(1)
      } finally {
        await db.execute(sql`
          drop trigger if exists t_romper on strategies;
          drop function if exists romper_una_vez();
          drop table if exists fallo_una_vez;
        `)
      }
    })
  })
```

Agregar `sql` al import de `drizzle-orm`.

> `sembrar` crea la estrategia de `2026-Q3`, así que el periodo `2026-Q4` no choca con ella y el `INSERT` es limpio.

- [ ] **Step 2: Ejecutar y verificar que falla**

```bash
pnpm --filter @gc/strategy test p1
```

Esperado: FALLA con `ClienteFalso se quedó sin respuestas predefinidas`.

- [ ] **Step 3: Partir el paso**

Mismo corte que en la Task 2, más simple porque no hay expansión. El tipo intermedio, interno:

```ts
interface SalidaDeLaGeneracion {
  brandId: string
  period: string
  datos: TipoEstrategia
  version: number
}
```

**Paso 1, `generar_estrategia`** — desde `validarPeriodo` hasta el `ejecutarTarea` inclusive, sin cambios. Devuelve `{ brandId, period, datos, version }`.

**Paso 2, `persistir_estrategia`** — el `insert ... onConflictDoUpdate` con su `setWhere`, la comprobación de `if (!fila)` con su relectura del estado y su `throw permanente`, y el `return` de `SalidaP1`.

**Lo que no debe cambiar:** que `validarPeriodo` corra antes que `exigirPresupuesto` y antes que cualquier llamada al modelo. Esa precedencia tiene una prueba que la fija y debe seguir verde.

- [ ] **Step 4: Ejecutar y verificar que pasa**

```bash
pnpm --filter @gc/strategy test p1
```

Esperado: PASA, incluidas las seis existentes sin tocarlas.

- [ ] **Step 5: Suite completa y commit**

```bash
pnpm test && pnpm -r typecheck
```

```bash
git add -A && git commit -m "feat: P1 separa la llamada al modelo de la persistencia"
```

---

### Task 4: Los mensajes nombran la marca por su slug

**Files:**
- Modify: `packages/pipeline/src/motor.ts`
- Modify: `packages/brand/src/repositorio.ts`
- Modify: `packages/ai/src/costos.ts`
- Modify: `packages/strategy/src/p1.ts`, `packages/strategy/src/p2.ts`
- Modify: `apps/cli/src/comandos.ts`
- Test: `apps/cli/src/organizacion.test.ts`
- Test: `packages/brand/src/repositorio.test.ts`

**Interfaces:**
- Produces:
  - `ContextoDeFlujo` y `ContextoDePaso` ganan `brandSlug?: string`
  - `cargarPerfilVigente(db, brandId, nombreVisible?)`
  - `verificarPresupuesto(db, brandId, mes, nombreVisible?)` y `exigirPresupuesto(db, brandId, mes, nombreVisible?)`
  - Todos los parámetros nuevos son **opcionales**: nada se rompe si falta, y el mensaje cae de vuelta al UUID.

- [ ] **Step 1: Escribir las pruebas que fallan**

En `apps/cli/src/organizacion.test.ts`:

```ts
  it('los errores nombran la marca por su slug, no por su UUID', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const organizationId = await resolverOrganizacion(db, { env: {} })
      const ref = await crearMarca(db, organizationId, { slug: 'parcelas', nombre: 'CTP' })
      await cargarPerfilDeObjeto(db, organizationId, {
        slug: 'parcelas', perfil: PERFIL_VALIDO,
      })

      // Sin estrategia para el trimestre: el mensaje nace en @gc/strategy,
      // que hoy solo conoce el brandId. Es el error que originó esta tarea.
      const error = await generarGrilla(db, new ClienteFalso([]), organizationId, {
        slug: 'parcelas', mes: '2026-09',
      }).catch((e: unknown) => e)

      expect((error as Error).message).toContain('parcelas')
      expect((error as Error).message).not.toContain(ref.brandId)
    })
  })
```

En `packages/brand/src/repositorio.test.ts`:

```ts
  it('nombra la marca por su nombre visible cuando se le da uno', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)

      const error = await cargarPerfilVigente(db, ref.brandId, 'parcelas')
        .catch((e: unknown) => e)

      expect((error as Error).message).toContain('parcelas')
      expect((error as Error).message).not.toContain(ref.brandId)
    })
  })
```

- [ ] **Step 2: Ejecutar y verificar que fallan**

```bash
pnpm --filter @gc/brand test repositorio
```

Esperado: FALLA — hoy el mensaje contiene el UUID y no acepta un tercer parámetro.

- [ ] **Step 3: Agregar el campo al contexto**

En `packages/pipeline/src/motor.ts`, agregar `brandSlug?: string` a `ContextoDeFlujo` y a `ContextoDePaso`, y propagarlo al construir `ctxPaso` con el mismo patrón condicional que ya se usa para `brandId`:

```ts
    ...(ctx.brandSlug !== undefined ? { brandSlug: ctx.brandSlug } : {}),
```

No se persiste en ninguna tabla: es dato de presentación, no de dominio.

- [ ] **Step 4: Aceptar un nombre visible en los tres consumidores**

Patrón idéntico en los tres, con el mismo nombre de parámetro y el mismo respaldo:

```ts
export async function cargarPerfilVigente(
  db: BaseDeDatos,
  brandId: string,
  nombreVisible?: string,
): Promise<PerfilVigente> {
  const marca = nombreVisible ?? brandId
  // ...
  if (!fila) throw permanente(`La marca ${marca} no tiene perfil cargado`)
```

Lo mismo en `verificarPresupuesto` y `exigirPresupuesto` de `packages/ai/src/costos.ts`, para sus dos mensajes (`No existe la marca ...` y `Presupuesto mensual agotado para la marca ...`).

En `p1.ts` y `p2.ts`, usar `ctx.brandSlug ?? entrada.brandId` en los mensajes propios, y pasar `ctx.brandSlug` a las tres funciones anteriores.

- [ ] **Step 5: Pasarlo desde el CLI**

En `apps/cli/src/comandos.ts`, `resolverMarca` ya tiene el slug en la mano: agregarlo a `ReferenciaResuelta` como `brandSlug`. Como esa referencia es justamente lo que se pasa a `ejecutarFlujo` como `ContextoDeFlujo`, el campo llega solo a los dos flujos sin más cambios.

- [ ] **Step 6: Ejecutar y verificar que pasan**

```bash
pnpm --filter @gc/brand test && pnpm --filter @gc/cli test
```

- [ ] **Step 7: Verificar a mano el mensaje que originó todo**

```bash
pnpm cli grilla:generar --marca parcelas --mes 2026-12 --seco
```

Esperado: el mensaje dice `La marca parcelas no tiene estrategia vigente para 2026-Q4`, sin UUID a la vista. **Reporta la salida literal.**

- [ ] **Step 8: Suite completa y commit**

```bash
pnpm test && pnpm -r typecheck
```

```bash
git add -A && git commit -m "feat: los mensajes nombran la marca por su slug"
```

---

## Cobertura de la especificación

| Decisión | Tarea | Estado |
|---|---|---|
| `NO ACTION` en la autorreferencia de `plan_slots` | 1 | Cubierto, con la prueba de que la regeneración sigue funcionando |
| La UI descarta en vez de borrar | — | Es una restricción de la Fase 1; la base ya la hace exigible |
| Partir P2 en modelo y persistencia | 2 | Cubierto |
| Partir P1 en modelo y persistencia | 3 | Cubierto |
| Propagar el slug hasta los cinco mensajes | 4 | Cubierto |

**Fuera de alcance, sigue en [pendientes.md](../specs/pendientes.md):** todo lo de Prioridad 2 — la consistencia de marca entre `content_plans` y `strategies`, los índices del lado referenciante, la tabla de precios de respaldo, los descartes silenciosos de `expandirDerivados`, y el resto.

## Siguiente plan

Fase 1: interfaz web y despliegue. Calendario editorial, bandeja de aprobación, worker en Cloud Run, Vercel + Google Cloud.
