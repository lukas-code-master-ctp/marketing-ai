# La sección avanzada y el prompt para IA — plan de implementación

> **Para quien ejecute esto:** SUB-SKILL OBLIGATORIA: usa `superpowers:subagent-driven-development` (recomendada) o `superpowers:executing-plans` para implementar tarea por tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** que la sección avanzada del editor de perfil muestre el formulario completo, y ofrezca un prompt copiable con el que una IA externa pueda rellenarlo.

**Arquitectura:** una opción nueva en la conversión que ya existe conserva las filas vacías en vez de descartarlas; una función pura arma el prompt a partir de esa misma conversión; y la sección avanzada de `EditorDePerfil` consume las dos. No se llama a ningún modelo desde la aplicación.

**Tecnologías:** React 19, Next.js 15 App Router, Vitest 2.1 con `jsdom` y `@testing-library/react`.

**Spec:** [2026-08-07-prompt-para-ia-design.md](../specs/2026-08-07-prompt-para-ia-design.md)

---

## Restricciones globales

Cada una es regla del proyecto (`CLAUDE.md`) y aplica a **todas** las tareas:

- **`pnpm test` en la raíz, NUNCA `pnpm -r test`.** Los paquetes comparten la base de pruebas y en paralelo se pisan.
- **Requiere Postgres levantado** para la suite completa: `docker compose up -d postgres`.
- **Idioma:** esquema y columnas de la base en inglés `snake_case`; variables, comentarios y **todo texto que ve el usuario**, en español.
- **TypeScript ESM:** los imports relativos llevan extensión `.js`, también desde `.tsx`.
- **`apps/web` no declara `@gc/brand`** y no debe declararlo. Las reglas del prompt van como texto literal.
- **El esquema Zod es la única autoridad de validación.** Nada de esto valida: el prompt *describe* reglas, no las hace cumplir.
- **El descarte de filas vacías al guardar NO se toca.** Es lo que evita que el esquema se queje de un elemento que nadie llenó.
- **Las pruebas de componente de este repositorio ya fallaron cuatro veces** afirmando contra el documento entero. Cada prueba se valida rompiendo el código y exigiendo que se ponga roja **por la razón exacta**.

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

## El código que ya existe y este plan modifica

`apps/web/src/componentes/perfil/conversion.ts` tiene hoy:

```ts
export function estaVacio(texto: string): boolean          // texto.trim() === ''
export function haciaElPerfil(f: PerfilEnFormulario): unknown
```

`haciaElPerfil` hace tres cosas que este plan vuelve opcionales:

1. `limpiarLista` recorta **y descarta** los textos vacíos.
2. Descarta los elementos de `publicos`, `pilares` y `ofertas` cuyos campos de texto estén **todos** vacíos.
3. **Omite la clave `url`** de una oferta cuando queda vacía.

Las tres son correctas **al guardar** y las tres estorban al copiar.

`apps/web/src/componentes/EditorDePerfil.tsx` tiene hoy:

```ts
const textoAvanzado = textoAvanzadoEditado ?? JSON.stringify(haciaElPerfil(formulario), null, 2)
```

---

## Estructura de archivos

**Crear:**

| Archivo | Responsabilidad |
|---|---|
| `apps/web/src/componentes/perfil/prompt.ts` | arma el texto del prompt. Sin React |
| `apps/web/src/componentes/perfil/prompt.test.ts` | pruebas de lo anterior, sin renderizar |

**Modificar:**

| Archivo | Cambio |
|---|---|
| `apps/web/src/componentes/perfil/conversion.ts` | `haciaElPerfil` acepta una opción que conserva lo vacío |
| `apps/web/src/componentes/perfil/conversion.test.ts` | pruebas de la opción nueva |
| `apps/web/src/componentes/EditorDePerfil.tsx` | la sección avanzada: el JSON completo y el bloque del prompt |
| `apps/web/src/componentes/EditorDePerfil.test.tsx` | pruebas de la sección avanzada |
| `docs/superpowers/specs/pendientes.md` | sumar la copia de las reglas a la entrada que ya existe |

---

## Task 1: la conversión conserva lo vacío cuando se le pide

**Archivos:**
- Modificar: `apps/web/src/componentes/perfil/conversion.ts`
- Modificar: `apps/web/src/componentes/perfil/conversion.test.ts`

**Interfaces:**
- Consume: `PerfilEnFormulario`, `estaVacio`, `aSnakeCase`, todos ya en el archivo.
- Produce, y lo consumen las Tasks 2 y 3:

```ts
export interface OpcionesDeConversion {
  /**
   * Con `true`, conserva las filas y los textos vacíos, y la clave `url`
   * aunque esté vacía. Para mostrar y copiar, no para guardar.
   */
  conservarVacios?: boolean
}

export function haciaElPerfil(f: PerfilEnFormulario, opciones?: OpcionesDeConversion): unknown
```

**La firma sigue siendo compatible:** `haciaElPerfil(f)` se comporta exactamente como hoy, así que el camino de guardado no cambia.

- [ ] **Paso 1: escribir las pruebas que fallan**

Agrega a `apps/web/src/componentes/perfil/conversion.test.ts`, dentro del `describe('haciaElPerfil')` que ya existe o en uno nuevo:

```ts
describe('haciaElPerfil con conservarVacios', () => {
  /** Un formulario con una fila vacía de cada clase. */
  const CON_VACIOS = {
    ...FORMULARIO_VACIO,
    posicionamiento: { categoria: 'Algo', promesa: 'Una promesa larga', diferenciadores: ['Uno', ''] },
    publicos: [{ nombre: '', dolor: '', objecion: '' }],
    pilares: [
      { nombre: 'educacion', descripcion: 'Enseña', porcentaje: 50 },
      { nombre: '', descripcion: '', porcentaje: 50 },
    ],
    ofertas: [{ nombre: 'Tour', descripcion: 'Visita al terreno', url: '' }],
  }

  it('conserva las filas vacías en vez de descartarlas', () => {
    // El caso que motivó el bloque: una IA que recibe `"publicos": []` no
    // tiene forma de saber que cada público lleva nombre, dolor y objeción.
    const s = haciaElPerfil(CON_VACIOS, { conservarVacios: true }) as {
      publicos: unknown[]
      pilares: unknown[]
      posicionamiento: { diferenciadores: string[] }
    }
    expect(s.publicos).toHaveLength(1)
    expect(s.publicos[0]).toEqual({ nombre: '', dolor: '', objecion: '' })
    expect(s.pilares).toHaveLength(2)
    expect(s.posicionamiento.diferenciadores).toEqual(['Uno', ''])
  })

  it('conserva la clave url aunque esté vacía', () => {
    // Al guardar se omite, porque el esquema la rechaza vacía. Al copiar se
    // conserva, porque es la única forma de que la IA sepa que existe.
    const s = haciaElPerfil(CON_VACIOS, { conservarVacios: true }) as {
      ofertas: Record<string, unknown>[]
    }
    expect(Object.hasOwn(s.ofertas[0]!, 'url')).toBe(true)
    expect(s.ofertas[0]!.url).toBe('')
  })

  it('sigue en la forma del ESQUEMA, no en la del formulario', () => {
    // La trampa que rompería el pegado de vuelta: el formulario tiene
    // `porcentaje: 50`, el esquema tiene `proporcion: 0.5`, y
    // `desdeElPerfil` lee `proporcion`.
    const s = haciaElPerfil(CON_VACIOS, { conservarVacios: true }) as {
      pilares: Record<string, unknown>[]
    }
    expect(s.pilares[0]!.proporcion).toBe(0.5)
    expect(Object.hasOwn(s.pilares[0]!, 'porcentaje')).toBe(false)
  })

  it('sin la opción se comporta exactamente como antes', () => {
    // La garantía de que el camino de guardado no cambió.
    const s = haciaElPerfil(CON_VACIOS) as {
      publicos: unknown[]
      pilares: unknown[]
      posicionamiento: { diferenciadores: string[] }
      ofertas: Record<string, unknown>[]
    }
    expect(s.publicos).toHaveLength(0)
    expect(s.pilares).toHaveLength(1)
    expect(s.posicionamiento.diferenciadores).toEqual(['Uno'])
    expect(Object.hasOwn(s.ofertas[0]!, 'url')).toBe(false)
  })

  it('lo que se conserva se puede volver a leer con desdeElPerfil', () => {
    // La garantía del pegado: copiar y volver a cargar reconstruye el mismo
    // formulario, filas vacías incluidas.
    const s = haciaElPerfil(CON_VACIOS, { conservarVacios: true })
    const vuelta = desdeElPerfil(s)
    expect(vuelta.publicos).toHaveLength(1)
    expect(vuelta.pilares).toHaveLength(2)
    expect(vuelta.pilares[1]!.porcentaje).toBe(50)
  })
})
```

- [ ] **Paso 2: correr y ver que fallan**

```bash
pnpm --filter @gc/web test -- conversion
```

Esperado: FALLAN las tres primeras y la quinta; **la cuarta pasa ya**, porque describe el comportamiento actual y es la que vigila que no cambie.

- [ ] **Paso 3: implementar la opción**

En `apps/web/src/componentes/perfil/conversion.ts`:

Agrega el tipo, junto a los demás exportados:

```ts
export interface OpcionesDeConversion {
  /**
   * Con `true`, conserva las filas y los textos vacíos, y la clave `url`
   * aunque esté vacía.
   *
   * Es para **mostrar y copiar**, no para guardar. Al guardar, lo vacío se
   * descarta a propósito: el formulario arranca las listas obligatorias con
   * una fila en blanco para que haya dónde escribir, y mandarla haría que el
   * esquema se queje de un elemento que nadie llenó.
   *
   * Al copiar pasa lo contrario: una lista vacía —`"publicos": []`— no le
   * dice a quien la lea que cada público lleva nombre, dolor y objeción. La
   * fila vacía **es** la documentación de la forma.
   */
  conservarVacios?: boolean
}
```

Cambia `limpiarLista` para que reciba la decisión:

```ts
function limpiarLista(lista: string[], conservarVacios: boolean): string[] {
  const recortada = lista.map((t) => t.trim())
  return conservarVacios ? recortada : recortada.filter((t) => t !== '')
}
```

Y en `haciaElPerfil`, tomar la opción al principio y usarla en los cuatro puntos donde hoy se descarta:

```ts
export function haciaElPerfil(f: PerfilEnFormulario, opciones?: OpcionesDeConversion): unknown {
  const conservar = opciones?.conservarVacios === true
```

- las tres llamadas a `limpiarLista(...)` pasan a `limpiarLista(..., conservar)`;
- los tres `.filter(...)` de `publicos`, `pilares` y `ofertas` solo se aplican cuando `!conservar`;
- la omisión de `url` solo ocurre cuando `!conservar`.

**No cambies nada más de la función.** El recorte con `trim()`, la conversión a `snake_case` y la división del porcentaje siguen ocurriendo en los dos casos: son la forma del esquema, no un descarte.

- [ ] **Paso 4: correr y ver que pasan**

```bash
pnpm --filter @gc/web test -- conversion
```

- [ ] **Paso 5: mutar y confirmar**

Dos mutaciones, una a la vez:

1. Que `conservar` sea siempre `true` → tiene que fallar `'sin la opción se comporta exactamente como antes'`, que es la que protege el camino de guardado.
2. Que `haciaElPerfil` devuelva `porcentaje` en vez de `proporcion` cuando conserva → tiene que fallar `'sigue en la forma del ESQUEMA'` **y** `'lo que se conserva se puede volver a leer'`. Que caigan las dos confirma que la trampa del pegado está cubierta por los dos lados.

- [ ] **Paso 6: la suite, el typecheck y commit**

```bash
pnpm test && pnpm -r typecheck
```

```bash
git add apps/web/src/componentes/perfil/ && git commit -m "feat(web): la conversión puede conservar lo vacío, para mostrar y copiar"
```

---

## Task 2: el prompt

**Archivos:**
- Crear: `apps/web/src/componentes/perfil/prompt.ts`
- Crear: `apps/web/src/componentes/perfil/prompt.test.ts`

**Interfaces:**
- Consume: `PerfilEnFormulario` y `haciaElPerfil(f, { conservarVacios: true })` de `./conversion.js` (Task 1).
- Produce, y lo consume Task 3:

```ts
export function promptParaIa(marca: string, formulario: PerfilEnFormulario): string
```

**Va en archivo propio y sin React** porque es texto que se puede probar sin renderizar nada, y porque quien quiera ajustar su redacción no debería tener que abrir un componente.

- [ ] **Paso 1: escribir las pruebas que fallan**

Crea `apps/web/src/componentes/perfil/prompt.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { FORMULARIO_VACIO } from './conversion.js'
import { promptParaIa } from './prompt.js'

const A_MEDIAS = {
  ...FORMULARIO_VACIO,
  posicionamiento: {
    categoria: 'Venta de autos usados',
    promesa: 'Autos revisados con garantía real',
    diferenciadores: ['Revisión de 120 puntos'],
  },
}

describe('promptParaIa', () => {
  it('nombra la marca', () => {
    expect(promptParaIa('tapcar', FORMULARIO_VACIO)).toContain('tapcar')
  })

  it('lleva el esqueleto con las claves de las filas vacías', () => {
    // Es el punto del bloque: sin esto, quien lea el prompt no puede saber
    // que un público lleva nombre, dolor y objeción.
    const p = promptParaIa('tapcar', FORMULARIO_VACIO)
    expect(p).toContain('"objecion"')
    expect(p).toContain('"proporcion"')
    expect(p).toContain('"disclaimers"')
  })

  it('conserva lo que ya se escribió, para que la IA complete y no reinvente', () => {
    expect(promptParaIa('tapcar', A_MEDIAS)).toContain('Autos revisados con garantía real')
  })

  it('dice las reglas que el esqueleto no puede mostrar', () => {
    const p = promptParaIa('tapcar', FORMULARIO_VACIO)
    expect(p).toMatch(/al menos dos pilares/i)
    expect(p).toMatch(/snake_case/)
    expect(p).toMatch(/suman?\s+1/i)
  })

  it('pide devolver solo JSON y sin filas vacías', () => {
    // Sin filas vacías porque el mismo archivo puede cargarse por el CLI, que
    // NO las descarta: `cargarPerfilDeArchivo` pasa el archivo directo a
    // validar, y ahí una fila en blanco hace fallar el esquema.
    const p = promptParaIa('tapcar', FORMULARIO_VACIO)
    expect(p).toMatch(/solo\s+JSON/i)
    expect(p).toMatch(/vac[ií]as/i)
  })

  it('el esqueleto es JSON válido por sí solo', () => {
    // Si el esqueleto quedara mal formado, lo que la IA devuelva heredaría el
    // problema. Se extrae el bloque entre la primera llave y la última.
    const p = promptParaIa('tapcar', FORMULARIO_VACIO)
    const desde = p.indexOf('{')
    const hasta = p.lastIndexOf('}')
    expect(() => JSON.parse(p.slice(desde, hasta + 1))).not.toThrow()
  })
})
```

- [ ] **Paso 2: correr y ver que fallan**

```bash
pnpm --filter @gc/web test -- prompt
```

Esperado: FALLAN las seis con `Failed to resolve import "./prompt.js"`.

- [ ] **Paso 3: escribir el prompt**

Crea `apps/web/src/componentes/perfil/prompt.ts`. La función arma un texto con tres partes, en este orden: la instrucción, las reglas, y el esqueleto al final —lo último que se lee es lo que hay que llenar—.

Las reglas, en español y como texto literal:

```
- `categoria`, `promesa` y al menos un `diferenciador` son obligatorios.
- Al menos un público, y cada uno lleva `nombre`, `dolor` y `objecion`. El
  dolor es el problema que esa persona tiene hoy; la objeción es lo que la
  frena justo antes de decidirse.
- Al menos un atributo de tono.
- **Al menos dos pilares.** Cada uno lleva `nombre` en `snake_case`
  —minúsculas, sin acentos, con guiones bajos, empezando por una letra—,
  `descripcion`, y `proporcion`.
- Las proporciones van de 0 a 1 —no en porcentaje— y **suman exactamente 1**
  entre todos los pilares.
- Las ofertas son opcionales, y dentro de cada una `url` también.
- `lexico` y `disclaimers` pueden ir vacíos.
```

Y la instrucción de cierre:

```
Devuelve SOLO el JSON completo, sin explicaciones alrededor y sin envolverlo
en un bloque de código, para que se pueda pegar de vuelta sin editar. No
dejes filas vacías: si no tienes información para un público, una oferta o
un disclaimer, quítalo en vez de dejarlo en blanco.
```

El esqueleto sale de `JSON.stringify(haciaElPerfil(formulario, { conservarVacios: true }), null, 2)`.

El archivo lleva un comentario de cabecera que diga que **las reglas son una copia** de las que declara `packages/brand/src/perfil.ts`, que `apps/web` no puede importar por la regla de aislamiento, y que si el esquema cambia hay que actualizarlas aquí.

- [ ] **Paso 4: correr y ver que pasan**

```bash
pnpm --filter @gc/web test -- prompt
```

- [ ] **Paso 5: mutar y confirmar**

Haz que el esqueleto se genere **sin** `conservarVacios` y corre de nuevo. **Tiene que fallar** `'lleva el esqueleto con las claves de las filas vacías'` — que es exactamente el defecto que este bloque vino a arreglar. Deshaz.

- [ ] **Paso 6: la suite, el typecheck y commit**

```bash
pnpm test && pnpm -r typecheck
```

```bash
git add apps/web/src/componentes/perfil/ && git commit -m "feat(web): el prompt que una IA externa necesita para rellenar el perfil"
```

---

## Task 3: la sección avanzada

**Archivos:**
- Modificar: `apps/web/src/componentes/EditorDePerfil.tsx`
- Modificar: `apps/web/src/componentes/EditorDePerfil.test.tsx`

**Interfaces:**
- Consume: `haciaElPerfil(f, { conservarVacios: true })` de `./perfil/conversion.js` (Task 1) y `promptParaIa(marca, formulario)` de `./perfil/prompt.js` (Task 2).
- Produce: nada que otra tarea importe.

- [ ] **Paso 1: escribir las pruebas que fallan**

Agrega a `apps/web/src/componentes/EditorDePerfil.test.tsx`:

```ts
  it('el JSON avanzado muestra el formulario completo, con sus filas vacías', async () => {
    // Antes mostraba lo que se GUARDARÍA, que descarta lo vacío: alguien con
    // una tarjeta «Público 1» delante veía `"publicos": []` y concluía,
    // razonablemente, que algo se había perdido.
    render(<EditorDePerfil {...PROPS} perfil={null} />)
    await userEvent.click(screen.getByText('Avanzado: ver o pegar el JSON'))

    const area = screen.getByLabelText('Perfil de marca en formato JSON') as HTMLTextAreaElement
    const mostrado = JSON.parse(area.value)
    expect(mostrado.publicos).toHaveLength(1)
    expect(mostrado.pilares).toHaveLength(2)
  })

  it('guardar sigue descartando lo vacío', async () => {
    // El cambio de la sección avanzada NO debe filtrarse al guardado.
    render(<EditorDePerfil {...PROPS} />)
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    const [, texto] = vi.mocked(guardarPerfilAction).mock.calls[0]!
    const enviado = JSON.parse(texto)
    expect(enviado.publicos.every((p: { nombre: string }) => p.nombre !== '')).toBe(true)
  })

  it('ofrece el prompt, con la marca dentro', async () => {
    render(<EditorDePerfil {...PROPS} />)
    await userEvent.click(screen.getByText('Avanzado: ver o pegar el JSON'))

    const area = screen.getByLabelText('Prompt para una IA') as HTMLTextAreaElement
    expect(area.value).toContain('parcelas')
    expect(area.value).toMatch(/al menos dos pilares/i)
  })

  it('si el portapapeles falla lo dice, y el texto sigue disponible', async () => {
    // `navigator.clipboard` exige contexto seguro y puede estar denegado. El
    // botón es una comodidad sobre un texto que ya se puede copiar a mano;
    // que falle no puede dejar a nadie sin salida.
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('denegado')) },
      configurable: true,
    })

    render(<EditorDePerfil {...PROPS} />)
    await userEvent.click(screen.getByText('Avanzado: ver o pegar el JSON'))
    await userEvent.click(screen.getByRole('button', { name: /Copiar prompt/ }))

    expect(screen.getByRole('alert').textContent).toMatch(/no se pudo copiar/i)
    const area = screen.getByLabelText('Prompt para una IA') as HTMLTextAreaElement
    expect(area.value).toContain('parcelas')
  })
```

**Nota sobre `PROPS`:** el archivo ya tiene una constante `PROPS` con un perfil completo. La primera prueba la usa con `perfil={null}` para forzar el formulario vacío; las demás la usan tal cual.

- [ ] **Paso 2: correr y ver que fallan**

```bash
pnpm --filter @gc/web test -- EditorDePerfil
```

Esperado: falla la primera (muestra `publicos: []`), fallan la tercera y la cuarta (no existe el prompt), y **pasa la segunda**, que vigila que el guardado no cambie.

- [ ] **Paso 3: implementar**

En `apps/web/src/componentes/EditorDePerfil.tsx`:

**El JSON completo.** La línea que arma el texto pasa a:

```ts
const textoAvanzado =
  textoAvanzadoEditado ?? JSON.stringify(haciaElPerfil(formulario, { conservarVacios: true }), null, 2)
```

Y un comentario que explique por qué **aquí sí** se conservan las filas vacías y en `guardar()` no.

**El bloque del prompt**, dentro del mismo `<details>`, debajo del botón de cargar y separado con una regla horizontal:

- un título que lo nombre;
- una línea que explique para qué sirve: pegarlo en una herramienta de IA que conozca la marca, y traer el resultado de vuelta al área de arriba;
- un `<textarea readOnly>` con `aria-label="Prompt para una IA"` y el valor de `promptParaIa(marca, formulario)`;
- un botón `Copiar prompt para IA`.

**El copiado, sin depender del portapapeles:**

```ts
const [copiado, setCopiado] = useState(false)
const [errorDeCopia, setErrorDeCopia] = useState<string | null>(null)

async function copiarPrompt() {
  setCopiado(false)
  setErrorDeCopia(null)
  try {
    await navigator.clipboard.writeText(promptParaIa(marca, formulario))
    setCopiado(true)
  } catch {
    // `navigator.clipboard` exige contexto seguro y puede estar denegado por
    // permisos; si no existe siquiera, el acceso lanza y cae aquí igual. El
    // texto ya está en pantalla y se puede seleccionar, así que el fallo se
    // informa y no bloquea nada.
    setErrorDeCopia(
      'No se pudo copiar automáticamente. Selecciona el texto de arriba y cópialo a mano.',
    )
  }
}
```

El aviso de fallo va con `role="alert"`; el de éxito, un texto simple.

- [ ] **Paso 4: correr y ver que pasan**

```bash
pnpm --filter @gc/web test -- EditorDePerfil
```

- [ ] **Paso 5: mutar y confirmar**

Dos mutaciones, una a la vez:

1. Quitar `{ conservarVacios: true }` de `textoAvanzado` → tiene que fallar `'el JSON avanzado muestra el formulario completo'`.
2. Agregar `{ conservarVacios: true }` a la llamada de `guardar()` → tiene que fallar `'guardar sigue descartando lo vacío'`. Es la que impide que este bloque se filtre al camino que sí importa.

- [ ] **Paso 6: la suite, el typecheck, el build y commit**

```bash
pnpm test && pnpm -r typecheck && pnpm --filter @gc/web build
```

El build tiene que seguir mostrando las rutas del dominio con `ƒ`.

```bash
git add apps/web/src/ && git commit -m "feat(web): la sección avanzada muestra el formulario y ofrece el prompt"
```

---

## Task 4: la deuda registrada y la verificación real

**Archivos:**
- Modificar: `docs/superpowers/specs/pendientes.md`

- [ ] **Paso 1: sumar la copia a la deuda que ya existe**

`pendientes.md` ya registra que la expresión del `snake_case` está copiada en `apps/web/src/componentes/perfil/conversion.ts` porque `apps/web` no puede importar `@gc/brand`.

Súmale que **las reglas del prompt** (`apps/web/src/componentes/perfil/prompt.ts`) son otra copia del mismo esquema, con la misma causa y el mismo riesgo: si `packages/brand/src/perfil.ts` cambia sus mínimos, el prompt sigue describiendo los viejos y nada se pone rojo.

Anota también lo que **sí** mitiga el riesgo: el esqueleto del prompt se genera de la conversión real y no está escrito a mano, así que la parte que más se equivocaría no es copia.

- [ ] **Paso 2: commit**

```bash
git add docs/superpowers/specs/pendientes.md && git commit -m "docs: las reglas del prompt son una segunda copia del esquema"
```

- [ ] **Paso 3: la verificación que ninguna prueba reemplaza**

**La hace el dueño y es la única que prueba que el bloque sirvió.**

Con la app levantada (`docker compose up -d postgres` y `pnpm --filter @gc/web dev`), en el perfil de una marca sin llenar:

1. Abrir la sección avanzada y **copiar el prompt**.
2. Pegarlo en la herramienta de IA que conozca la marca, y pedirle que lo complete.
3. **Pegar lo que devuelva** en el área de JSON de arriba y cargarlo.
4. Guardar.

Lo que hay que responder:

- ¿El JSON que devolvió **entró sin errores**? Si no, **qué dijo el error** — eso dice qué regla le falta al prompt.
- ¿Lo que rellenó tiene sentido, o se nota que adivinó?
- ¿Quedó algún campo que la IA dejó vacío porque el prompt no le explicó qué era?

**Si algo falla, lo que hay que arreglar son las reglas del prompt, no el código.** Y si el error viene del esquema —proporciones que no suman 1, un nombre de pilar mal formado—, la regla correspondiente hay que escribirla más explícita.

---

## Autorrevisión de este plan

**Cobertura del spec:**

| Sección del spec | Tarea |
|---|---|
| La sección avanzada muestra el formulario completo | Tasks 1 y 3 |
| Sigue en la forma del esquema, no la del formulario | Task 1, prueba dedicada |
| El descarte al guardar no se toca | Tasks 1 y 3, con prueba y mutación en cada una |
| El esqueleto generado, no escrito a mano | Task 2, con mutación |
| Las reglas en prosa | Task 2 |
| La instrucción de devolver solo JSON y sin filas vacías | Task 2 |
| Copiar sin depender del portapapeles | Task 3 |
| La costura de la copia, registrada | Task 4 |
| Ida y vuelta del pegado | Task 1, última prueba |
| Verificación con la IA real | Task 4 paso 3 |

Sin huecos.

**Consistencia de nombres:** `OpcionesDeConversion` y `haciaElPerfil(f, opciones?)` se producen en Task 1 y se consumen con esa firma en 2 y 3. `promptParaIa(marca, formulario)` se produce en Task 2 y se consume igual en 3. Los `aria-label` del área de JSON —`Perfil de marca en formato JSON`— y del prompt —`Prompt para una IA`— son los mismos en la implementación y en las pruebas de Task 3.

**Una nota sobre el orden de las pruebas de la Task 1 y la 3:** en las dos hay una prueba que **pasa desde el principio**. No es un descuido: son las que vigilan que el camino de guardado no cambie, y su valor está en ponerse rojas si alguien lo cambia después. La mutación de cada tarea lo confirma.
