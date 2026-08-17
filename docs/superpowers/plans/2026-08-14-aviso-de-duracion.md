# El aviso de duración — plan de implementación

> **Para quien ejecute esto:** SUB-SKILL OBLIGATORIA: usa `superpowers:subagent-driven-development` (recomendada) o `superpowers:executing-plans` para implementar tarea por tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** que el panel de «generando» muestre cuánto lleva esperando, para que una espera de minutos no se lea como una pantalla colgada.

**Arquitectura:** un formateador nuevo, puro y sin dependencias, junto al que ya existe en `@gc/operaciones/senales`; y el panel de `EstadoDeCorrida` que lo consume con un dato que ya viaja. No se toca el dominio, ni la consulta, ni el refresco.

**Tecnologías:** TypeScript ESM, Vitest 2.1 con `jsdom` y `@testing-library/react` para el componente, y Vitest en entorno `node` para el formateador.

**Spec:** [2026-08-14-aviso-de-duracion-design.md](../specs/2026-08-14-aviso-de-duracion-design.md)

---

## Restricciones globales

Cada una es regla del proyecto (`CLAUDE.md`) y aplica a **todas** las tareas:

- **`pnpm test` en la raíz, NUNCA `pnpm -r test`.** Los paquetes comparten la base de pruebas y en paralelo se pisan.
- **Requiere Postgres levantado** para la suite completa: `docker compose up -d postgres`.
- **Idioma:** variables, comentarios y **todo texto que ve el usuario**, en español neutro latinoamericano con «tú».
- **TypeScript ESM:** los imports relativos llevan extensión `.js`, también desde `.tsx`.
- **`senales.ts` no importa nada en tiempo de ejecución.** Su único `import` es de tipo y se borra al compilar. Es lo que permite que un componente de cliente lo consuma sin arrastrar drizzle ni el driver de Postgres al bundle del navegador. **No agregues ningún import de valor a ese archivo.**
- **`describirAntiguedad` no se toca.** Sus dos consumidores hablan de un pasado difuso y ahí redondear a minutos se lee mejor.
- **El panel no promete ninguna duración.** Muestra tiempo transcurrido, no estimado.
- **Una prueba de componente puede afirmar contra el documento entero y parecer que verifica el lugar correcto.** Ya ocurrió cuatro veces, y los dos bloques anteriores encontraron quince más. Cada prueba se valida rompiendo el código y exigiendo que se ponga roja **por la razón exacta**.

**Comandos de verificación** (antes de cada commit):

```bash
pnpm test
```

```bash
pnpm -r typecheck
```

```bash
pnpm --filter @gc/web build
```

---

## Estructura de archivos

**Crear:**

| Archivo | Responsabilidad |
|---|---|
| `packages/operaciones/src/senales.test.ts` | pruebas de los dos formateadores, sin base y sin render |

**Modificar:**

| Archivo | Cambio |
|---|---|
| `packages/operaciones/src/senales.ts` | agregar `describirDuracion` |
| `apps/web/src/componentes/EstadoDeCorrida.tsx` | el panel azul muestra la duración |
| `apps/web/src/componentes/EstadoDeCorrida.test.tsx` | pruebas del panel |

**Un hallazgo que cambia el plan respecto de lo que el spec suponía.** El spec dice «que `describirAntiguedad` siga intacta: sus pruebas actuales no cambian». Al mirarlo: **esa función no tiene pruebas propias.** Solo se ejercita de refilón desde `EstadoDeCorrida.test.tsx`, a través del texto de dos paneles, y `packages/operaciones` no tiene ningún `senales.test.ts`. Así que la Task 1 crea ese archivo y cubre **las dos** funciones: el punto entero de tener dos formateadores es que se comportan distinto, y una prueba que no compare los dos comportamientos no protege esa decisión de nada.

---

## Task 1: el formateador

**Archivos:**
- Modificar: `packages/operaciones/src/senales.ts`
- Crear: `packages/operaciones/src/senales.test.ts`

**Interfaces:**
- Consume: nada. Es una función pura.
- Produce, y lo consume la Task 2:

```ts
export function describirDuracion(segundos: number): string
```

**Contrato exacto**, que es todo lo que hay que acertar:

| Entrada | Salida |
|---|---|
| `0` | `'0 s'` |
| `1` | `'1 s'` |
| `42` | `'42 s'` |
| `59` | `'59 s'` |
| `60` | `'1 min 0 s'` |
| `61` | `'1 min 1 s'` |
| `252` | `'4 min 12 s'` |
| `-5` | `'0 s'` |
| `42.9` | `'42 s'` |
| `60.9` | `'1 min 0 s'` |

**Los segundos no se omiten cuando son cero** (`'1 min 0 s'`, nunca `'1 min'`): el punto del contador es que el número se mueva, y `1 min` a secas quedaría inmóvil sesenta segundos, que es el defecto que este bloque viene a arreglar.

- [ ] **Paso 1: escribir las pruebas que fallan**

Crea `packages/operaciones/src/senales.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { describirAntiguedad, describirDuracion } from './senales.js'

describe('describirDuracion', () => {
  it('bajo el minuto dice segundos', () => {
    expect(describirDuracion(0)).toBe('0 s')
    expect(describirDuracion(1)).toBe('1 s')
    expect(describirDuracion(42)).toBe('42 s')
    expect(describirDuracion(59)).toBe('59 s')
  })

  it('de un minuto arriba dice minutos y segundos', () => {
    expect(describirDuracion(60)).toBe('1 min 0 s')
    expect(describirDuracion(61)).toBe('1 min 1 s')
    expect(describirDuracion(252)).toBe('4 min 12 s')
    expect(describirDuracion(3600)).toBe('60 min 0 s')
  })

  it('no omite los segundos en el minuto exacto', () => {
    // `1 min` a secas quedaría inmóvil sesenta segundos, que es justo el
    // defecto que este contador existe para arreglar.
    expect(describirDuracion(60)).not.toBe('1 min')
    expect(describirDuracion(120)).toBe('2 min 0 s')
  })

  it('recorta la entrada igual que su vecina', () => {
    // Relojes desfasados entre la base y el proceso pueden dar un negativo.
    expect(describirDuracion(-5)).toBe('0 s')
    expect(describirDuracion(42.9)).toBe('42 s')
    expect(describirDuracion(60.9)).toBe('1 min 0 s')
  })
})

describe('describirAntiguedad', () => {
  // No tenía pruebas propias: se ejercitaba de refilón desde el panel. Se
  // cubre acá porque el punto de tener DOS formateadores es que difieren, y
  // sin esta comparación nada protege esa decisión.
  it('redondea a minutos por encima del minuto, sin segundos', () => {
    expect(describirAntiguedad(60)).toBe('1 minuto')
    expect(describirAntiguedad(252)).toBe('4 minutos')
    expect(describirAntiguedad(899)).toBe('14 minutos')
  })

  it('bajo el minuto dice segundos, en palabras', () => {
    expect(describirAntiguedad(1)).toBe('1 segundo')
    expect(describirAntiguedad(42)).toBe('42 segundos')
  })

  it('difiere de describirDuracion justo donde tiene que diferir', () => {
    // Si alguien las unifica, esta prueba lo dice. Los dos textos existen
    // porque uno habla de un pasado difuso —«sin señal desde hace 4
    // minutos»— y el otro de un contador que se mira avanzar.
    expect(describirAntiguedad(252)).not.toBe(describirDuracion(252))
  })
})
```

- [ ] **Paso 2: correr y ver que fallan**

```bash
pnpm --filter @gc/operaciones test -- senales
```

Esperado: los cuatro `describe('describirDuracion')` fallan con `describirDuracion is not a function`; los de `describirAntiguedad` pasan ya, porque describen lo que esa función hace hoy.

- [ ] **Paso 3: implementar**

En `packages/operaciones/src/senales.ts`, justo **después** de `describirAntiguedad`:

```ts
/**
 * Duración en palabras, para un contador que se mira avanzar.
 *
 * Difiere de `describirAntiguedad` a propósito, y la diferencia es el motivo
 * de que existan las dos: aquella redondea a minutos, porque habla de un
 * pasado difuso —«no da señales desde hace 15 minutos»—, y ahí «15 min 3 s»
 * sería precisión falsa. Esta muestra los segundos siempre, porque su único
 * trabajo es demostrar que algo sigue vivo: con el refresco de dos segundos
 * del panel, el número se mueve, y un número que se mueve es la diferencia
 * entre «está trabajando» y «se colgó».
 *
 * Por eso los segundos tampoco se omiten cuando son cero: `1 min` a secas
 * quedaría inmóvil sesenta segundos.
 *
 * El recorte de la entrada es el mismo que aplica su vecina —relojes
 * desfasados entre la base y el proceso pueden dar un negativo— y conviene
 * que las dos coincidan en eso.
 */
export function describirDuracion(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos))
  if (s < 60) return `${s} s`
  return `${Math.floor(s / 60)} min ${s % 60} s`
}
```

- [ ] **Paso 4: correr y ver que pasan**

```bash
pnpm --filter @gc/operaciones test -- senales
```

- [ ] **Paso 5: comprobar que `senales.ts` sigue sin importar valores**

El archivo tiene que seguir teniendo **un solo** `import`, y de tipo:

```bash
grep -n "^import" packages/operaciones/src/senales.ts
```

Esperado: exactamente una línea, `import type { CorridaEnCurso } from './corridas.js'`. Si tu implementación agregó cualquier otro import, quítalo: ese archivo entra al bundle del navegador.

- [ ] **Paso 6: mutar y confirmar**

Tres mutaciones, una a la vez, revirtiendo entre cada una:

1. Devolver `` `${Math.floor(s / 60)} min` `` cuando `s % 60 === 0` → tiene que caer `'no omite los segundos en el minuto exacto'`.
2. Cambiar `Math.floor(segundos)` por `Math.round(segundos)` → tiene que caer `'recorta la entrada igual que su vecina'`, por el caso `60.9`.
3. Hacer que `describirDuracion` delegue en `describirAntiguedad` → tiene que caer `'difiere de describirDuracion justo donde tiene que diferir'`. Es la que protege la decisión de tener dos.

- [ ] **Paso 7: la suite, el typecheck y commit**

```bash
pnpm test && pnpm -r typecheck
```

```bash
git add packages/operaciones/src/ && git commit -m "feat(operaciones): describirDuracion, para un contador que se mira avanzar"
```

---

## Task 2: el panel

**Archivos:**
- Modificar: `apps/web/src/componentes/EstadoDeCorrida.tsx`
- Modificar: `apps/web/src/componentes/EstadoDeCorrida.test.tsx`

**Interfaces:**
- Consume: `describirDuracion` de `@gc/operaciones/senales` (Task 1), y `corrida.encoladaHace`, que ya viaja en `CorridaEnCurso` y ya se calcula.
- Produce: nada que otra tarea importe.

**El import va del submódulo, no del barril.** El archivo ya importa `describirAntiguedad` y `SEGUNDOS_SIN_SENAL_PARA_ABANDONO` de `@gc/operaciones/senales` por ese motivo, con el comentario que lo explica arriba. Agrega `describirDuracion` a **ese mismo** import.

**Solo cambia el último `return`**, el del panel azul. Los tres paneles de arriba —fallida, interrumpida, abandonada— y sus umbrales no se tocan.

- [ ] **Paso 1: escribir las pruebas que fallan**

Agrega a `apps/web/src/componentes/EstadoDeCorrida.test.tsx`, dentro del `describe('EstadoDeCorrida')` que ya existe:

```tsx
  it('el panel de generando dice cuánto lleva, con minutos y segundos', () => {
    // 252 segundos son los 4,2 minutos que tardó la primera grilla real. El
    // texto se afirma completo a propósito: `/4/` calzaría con cualquier cosa
    // —incluido un periodo como 2026-Q4— y este repositorio ya pagó cuatro
    // veces una aserción que parecía verificar el lugar correcto.
    render(
      <EstadoDeCorrida
        corrida={corrida({ estado: 'en_curso', pasoActual: 'proponer_grilla', encoladaHace: 252 })}
        ruta="/parcelas/grilla/2026-10"
      />,
    )
    expect(screen.queryByText(/proponiendo la grilla… \(4 min 12 s\)/i)).not.toBeNull()
  })

  it('bajo el minuto dice solo segundos', () => {
    render(
      <EstadoDeCorrida
        corrida={corrida({ estado: 'en_curso', pasoActual: 'generar_estrategia', encoladaHace: 9 })}
        ruta="/parcelas/estrategia"
      />,
    )
    expect(screen.queryByText(/generando la estrategia… \(9 s\)/i)).not.toBeNull()
  })

  it('en cola también dice cuánto lleva', () => {
    render(<EstadoDeCorrida corrida={corrida({ encoladaHace: 12 })} ruta="/parcelas/estrategia" />)
    expect(screen.queryByText(/en cola… \(12 s\)/i)).not.toBeNull()
  })

  it('el panel de interrumpida sigue redondeando a minutos, sin segundos', () => {
    // Los dos formateadores conviven en el mismo componente. Si alguien
    // reemplaza el de allá por el nuevo, este texto pasa a decir
    // «15 min 1 s» y esta prueba lo dice.
    render(
      <EstadoDeCorrida
        corrida={corrida({ estado: 'en_curso', pasoActual: 'proponer_grilla', segundosSinSenal: 901 })}
        ruta="/parcelas/grilla/2026-10"
      />,
    )
    expect(screen.queryByText(/15 minutos/)).not.toBeNull()
    expect(screen.queryByText(/15 min 1 s/)).toBeNull()
  })
```

**Ojo con el carácter del paréntesis:** el texto usa los puntos suspensivos de un solo carácter (`…`), que es el que el componente ya usa hoy. Si tu implementación emite tres puntos (`...`), las aserciones no calzan — y la que hay que corregir es la implementación, para no cambiar el aspecto del panel.

- [ ] **Paso 2: correr y ver que fallan**

```bash
pnpm --filter @gc/web test -- EstadoDeCorrida
```

Esperado: fallan las tres primeras, porque el panel no muestra ninguna duración. **La cuarta pasa ya**: describe el comportamiento actual del panel de interrumpida, y su valor está en ponerse roja si alguien unifica los dos formateadores.

- [ ] **Paso 3: implementar**

En `apps/web/src/componentes/EstadoDeCorrida.tsx`, agrega `describirDuracion` al import que ya existe:

```tsx
import {
  describirAntiguedad,
  describirDuracion,
  SEGUNDOS_SIN_SENAL_PARA_ABANDONO,
} from '@gc/operaciones/senales'
```

Y el último `return` pasa a:

```tsx
  // La duración va detrás del paso y entre paréntesis, no como frase aparte:
  // es tiempo **transcurrido**, y una frase suelta se leería como una promesa
  // de cuánto falta —que este sistema no puede sostener—. Sale de
  // `encoladaHace`, o sea desde que se encoló y no desde que empezó el paso:
  // lo que le sirve a quien mira es cuánto lleva esperando desde que apretó
  // el botón. Reanudar reinicia esa marca, así que el contador vuelve a cero.
  const cuantoLleva = describirDuracion(corrida.encoladaHace)

  return (
    <div className="mb-4 rounded border border-blue-300 bg-blue-50 p-3 text-sm text-blue-900">
      {corrida.estado === 'pendiente'
        ? `En cola… (${cuantoLleva})`
        : `${corrida.pasoActual ? (PASOS_EN_PROSA[corrida.pasoActual] ?? corrida.pasoActual) : 'Generando'}… (${cuantoLleva})`}
    </div>
  )
```

- [ ] **Paso 4: correr y ver que pasan**

```bash
pnpm --filter @gc/web test -- EstadoDeCorrida
```

- [ ] **Paso 5: mutar y confirmar**

Tres mutaciones, una a la vez, revirtiendo entre cada una:

1. Quitar `(${cuantoLleva})` de la rama de `en_curso` → tienen que caer las dos primeras y **no** la de «en cola».
2. Quitar `(${cuantoLleva})` de la rama de `pendiente` → tiene que caer solo `'en cola también dice cuánto lleva'`.
3. Cambiar `describirDuracion` por `describirAntiguedad` en el panel de interrumpida → tiene que caer `'el panel de interrumpida sigue redondeando a minutos'`. Es la que impide que los dos formateadores se confundan.

- [ ] **Paso 6: la suite, el typecheck, el build y commit**

```bash
pnpm test && pnpm -r typecheck && pnpm --filter @gc/web build
```

El build tiene que seguir mostrando las cinco rutas del dominio con `ƒ` y no con `○`.

```bash
git add apps/web/src/componentes/ && git commit -m "feat(web): el panel de generando dice cuánto lleva esperando"
```

- [ ] **Paso 7: mirarlo en el navegador**

Con `docker compose up -d postgres` y `pnpm --filter @gc/web dev`, abre la grilla de una marca con una corrida viva y comprueba que **el número avanza** cada dos segundos. Es lo único que ninguna prueba puede afirmar: que el contador se vea moverse.

Si no hay ninguna corrida viva a mano, la base de desarrollo tiene la marca `parcelas`; encolar una grilla del mes siguiente sirve, y **si eso modifica la base de desarrollo hay que restaurarla** —`parcelas` tiene que quedar con su perfil, su estrategia `2026-Q3` y su grilla de `2026-09` en borrador—.

---

## Autorrevisión de este plan

**Cobertura del spec:**

| Sección del spec | Tarea |
|---|---|
| `describirDuracion` con sus dos tramos | Task 1, con la tabla del contrato |
| Los segundos no se omiten en el minuto exacto | Task 1, prueba dedicada y mutación 1 |
| El recorte `Math.max(0, Math.floor(...))` | Task 1, prueba dedicada y mutación 2 |
| `describirAntiguedad` no se toca | Task 1 la cubre sin cambiarla; Task 2 mutación 3 |
| Vive en `senales.ts`, que no importa valores | Task 1 paso 5, con su comprobación |
| El panel azul muestra la duración | Task 2 |
| «En cola…» también | Task 2, prueba dedicada |
| Sale de `encoladaHace` | Task 2, con el porqué comentado |
| No promete ninguna duración | Task 2, comentado, y ninguna prueba afirma un estimado |
| Que el número se mueva | Task 2 paso 7, que es lo único que exige el navegador |

Sin huecos.

**Consistencia de nombres:** `describirDuracion(segundos: number): string` se produce en la Task 1 y se consume con esa firma en la Task 2. `encoladaHace` y `segundosSinSenal` son los nombres reales de `CorridaEnCurso`, y el ayudante `corrida(...)` de las pruebas ya los trae con valores por omisión.

**Tres avisos para quien ejecute, que no son descuidos:**

1. **El spec suponía que `describirAntiguedad` tenía pruebas propias y no las tiene.** La Task 1 crea el archivo que faltaba y cubre las dos funciones. Está explicado en §Estructura de archivos.
2. **La cuarta prueba de la Task 2 pasa desde el principio.** No es un descuido: vigila que nadie unifique los dos formateadores, y su mutación lo confirma.
3. **El carácter `…`.** Las aserciones del panel usan los puntos suspensivos de un solo carácter, que es el que el componente ya usa. Emitir `...` rompe las pruebas, y lo que hay que corregir es la implementación.
