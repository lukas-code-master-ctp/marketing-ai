# El editor visual del perfil de marca — plan de implementación

> **Para quien ejecute esto:** SUB-SKILL OBLIGATORIA: usa `superpowers:subagent-driven-development` (recomendada) o `superpowers:executing-plans` para implementar tarea por tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** que el perfil de marca se llene con un formulario guiado en vez de un `textarea` de JSON crudo.

**Arquitectura:** cambio puramente de la capa web. El formulario mantiene el perfil como un objeto en memoria con la forma cómoda para editar —porcentajes enteros, URL como cadena— y un módulo de conversión sin React lo traduce al JSON del esquema al guardar. La Server Action, el esquema, el versionado y el CLI no se tocan.

**Tecnologías:** Next.js 15 App Router, React 19, Tailwind, Vitest 2.1 con `jsdom` y `@testing-library/react`.

**Spec:** [2026-08-07-editor-visual-de-perfil-design.md](../specs/2026-08-07-editor-visual-de-perfil-design.md)

---

## Dos correcciones al spec, encontradas al escribir este plan

**1. El estado vacío cambia de significado, y el spec no lo trató.**

Hoy, una marca sin perfil recibe `PLANTILLA_DE_PERFIL` **como valor** del `textarea`: los campos vienen llenos de textos de relleno («En qué categoría compite la marca») que hay que borrar uno por uno. En un formulario eso es hostil: nadie quiere seleccionar y borrar antes de escribir.

**Decisión: en el formulario esos textos son marcadores de posición, no valores.** Los campos arrancan vacíos, con el texto de la plantilla en gris dentro del campo. Las listas arrancan con un elemento vacío, y los pilares con **dos** filas —el mínimo del esquema— repartidas en 50 y 50, porque el total tiene que sumar 100 de todos modos.

Consecuencia que hay que aceptar a conciencia: el comentario de `perfil/page.tsx` justifica la plantilla-como-valor diciendo que así editar «no empieza con una lista de reglas rotas». Con campos vacíos, guardar demasiado pronto sí produce una lista de errores del esquema. Es el comportamiento normal de un formulario y se mitiga marcando los campos vacíos **antes** de intentar guardar, que es lo que un `textarea` no podía hacer.

**2. La guarda de «plantilla sin cambios» queda inalcanzable desde la web, y está bien.**

`cargarPerfilDeObjeto` rechaza guardar un perfil idéntico a `PLANTILLA_DE_PERFIL` (`packages/operaciones/src/perfiles.ts`). Con campos vacíos, lo que la web envía nunca va a ser igual a la plantilla, así que esa guarda deja de dispararse por este camino.

**No se toca.** Sigue cubriendo el CLI (`perfil:cargar --archivo`), que es donde alguien podría cargar la plantilla tal cual desde un archivo, y su comentario ya explica que vive ahí porque el CLI entra por la misma puerta. Lo que este plan agrega es que la web ahora falla antes y con mejor mensaje, no que la guarda sobre.

---

## Restricciones globales

Cada una es regla del proyecto (`CLAUDE.md`) y aplica a **todas** las tareas:

- **`pnpm test` en la raíz, NUNCA `pnpm -r test`.** Los paquetes comparten la base de pruebas y en paralelo se pisan.
- **Requiere Postgres levantado** para la suite completa: `docker compose up -d postgres`.
- **Idioma:** esquema y columnas de la base en inglés `snake_case`; API de dominio, variables, comentarios y **todo texto que ve el usuario**, en español.
- **TypeScript ESM:** los imports relativos llevan extensión `.js`, también desde `.tsx`.
- **`apps/web` no declara `@gc/brand`** y no debe declararlo. Los ejemplos van copiados como texto literal.
- **El esquema Zod es la única autoridad de validación.** El formulario **no** vuelve a declarar los mínimos de longitud. Solo previene lo que es propiedad del control: el total de los pilares, el mínimo de elementos de una lista, y los nombres de pilar repetidos o no convertibles.
- **Las pruebas de componente de este repositorio ya fallaron cuatro veces** afirmando contra el documento entero y pareciendo verificar el lugar correcto. Cada prueba se valida rompiendo el código a propósito y exigiendo que se ponga roja **por la razón exacta**.
- **Cada ruta de Next necesita su propio `export const dynamic = 'force-dynamic'`.** `perfil/page.tsx` ya lo tiene y no se toca.

**Comandos de verificación** (los tres, antes de cada commit):

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

## El esquema, que es el contrato que todo esto respeta

De `packages/brand/src/perfil.ts`. **Copiado aquí porque cada tarea lo necesita y nadie debería adivinarlo:**

| Campo | Regla |
|---|---|
| `posicionamiento.categoria` | texto, mínimo 3 |
| `posicionamiento.promesa` | texto, mínimo 10 |
| `posicionamiento.diferenciadores` | lista de textos de mínimo 3, **al menos 1** |
| `publicos` | lista de `{nombre ≥3, dolor ≥10, objecion ≥10}`, **al menos 1** |
| `tono.atributos` | lista de textos de mínimo 3, **al menos 1** |
| `tono.hacer`, `tono.noHacer` | listas de textos de mínimo 3, pueden ir vacías |
| `lexico.preferido`, `lexico.prohibido` | listas de textos, pueden ir vacías |
| `pilares` | lista de `{nombre snake_case, descripcion ≥5, proporcion 0..1}`, **al menos 2** |
| `ofertas` | lista de `{nombre ≥3, descripcion ≥5, url opcional y con forma de URL}`, puede ir vacía |
| `restricciones.disclaimers` | lista de textos, puede ir vacía |

Además, fuera del esquema y dentro de `validarPerfil`: **las proporciones suman 1** con tolerancia 0,01, y **los nombres de pilar no se repiten**.

---

## Estructura de archivos

**Crear**, todo bajo `apps/web/src/componentes/perfil/`:

| Archivo | Responsabilidad |
|---|---|
| `conversion.ts` | del formulario al JSON del esquema y de vuelta. Sin React |
| `conversion.test.ts` | pruebas de lo anterior, sin renderizar nada |
| `campos.tsx` | las primitivas: campo de texto con ayuda y ejemplo, lista de textos |
| `campos.test.tsx` | pruebas de las primitivas |
| `secciones.tsx` | las seis secciones que componen primitivas |
| `Pilares.tsx` | el control especial: porcentajes, total, `snake_case` |
| `Pilares.test.tsx` | pruebas del control especial |
| `ejemplos.ts` | los textos de ayuda y ejemplo, en un solo lugar |

**Modificar:**

| Archivo | Cambio |
|---|---|
| `apps/web/src/componentes/EditorDePerfil.tsx` | de `textarea` a orquestador del formulario |
| `apps/web/src/componentes/EditorDePerfil.test.tsx` | las tres pruebas existentes, adaptadas |
| `apps/web/src/app/(app)/[marca]/perfil/page.tsx` | el aviso del estado vacío |

---

## Task 1: el módulo de conversión

**Archivos:**
- Crear: `apps/web/src/componentes/perfil/conversion.ts`
- Crear: `apps/web/src/componentes/perfil/conversion.test.ts`

**Interfaces:**
- Consume: nada.
- Produce, y lo consumen todas las tareas siguientes:

```ts
export interface PublicoEnFormulario { nombre: string; dolor: string; objecion: string }
export interface PilarEnFormulario { nombre: string; descripcion: string; porcentaje: number }
export interface OfertaEnFormulario { nombre: string; descripcion: string; url: string }

export interface PerfilEnFormulario {
  posicionamiento: { categoria: string; promesa: string; diferenciadores: string[] }
  publicos: PublicoEnFormulario[]
  tono: { atributos: string[]; hacer: string[]; noHacer: string[] }
  lexico: { preferido: string[]; prohibido: string[] }
  pilares: PilarEnFormulario[]
  ofertas: OfertaEnFormulario[]
  restricciones: { disclaimers: string[] }
}

export const FORMULARIO_VACIO: PerfilEnFormulario
export function aSnakeCase(texto: string): string
export function desdeElPerfil(crudo: unknown): PerfilEnFormulario
export function haciaElPerfil(f: PerfilEnFormulario): unknown
```

**Por qué esta tarea va primera y aparte:** es donde vive la lógica que puede fallar en silencio —un campo que no sobrevive la ida y vuelta— y es la única parte de este bloque que se prueba sin renderizar nada.

- [ ] **Paso 1: escribir las pruebas que fallan**

Crea `apps/web/src/componentes/perfil/conversion.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  aSnakeCase,
  desdeElPerfil,
  haciaElPerfil,
  FORMULARIO_VACIO,
} from './conversion.js'

/** Un perfil completo y válido, con todos los campos poblados. */
const PERFIL = {
  posicionamiento: {
    categoria: 'Venta de parcelas de agrado',
    promesa: 'Parcelas con factibilidad garantizada y trazabilidad legal completa',
    diferenciadores: ['Factibilidad verificada', 'Financiamiento directo'],
  },
  publicos: [
    {
      nombre: 'Inversionista primerizo',
      dolor: 'Teme comprar un terreno sin agua ni acceso legal',
      objecion: 'No sabe distinguir una parcela regularizada de una que no lo está',
    },
  ],
  tono: {
    atributos: ['claro', 'didáctico'],
    hacer: ['Explicar con datos concretos'],
    noHacer: ['Prometer retornos'],
  },
  lexico: { preferido: ['factibilidad'], prohibido: ['oportunidad única'] },
  pilares: [
    { nombre: 'educacion', descripcion: 'Sobre qué enseña la marca', proporcion: 0.6 },
    { nombre: 'producto', descripcion: 'Qué vende la marca', proporcion: 0.4 },
  ],
  ofertas: [
    { nombre: 'Tour guiado', descripcion: 'Visita al terreno', url: 'https://ejemplo.cl/tour' },
  ],
  restricciones: { disclaimers: ['Imágenes referenciales'] },
}

describe('ida y vuelta', () => {
  it('un perfil completo sobrevive la conversión sin perder nada', () => {
    // LA PRUEBA CENTRAL DE TODO EL BLOQUE. Si el formulario no sabe
    // representar un campo, se pierde acá y no en producción.
    expect(haciaElPerfil(desdeElPerfil(PERFIL))).toEqual(PERFIL)
  })
})

describe('desdeElPerfil', () => {
  it('convierte las proporciones a porcentajes enteros', () => {
    expect(desdeElPerfil(PERFIL).pilares.map((p) => p.porcentaje)).toEqual([60, 40])
  })

  it('una oferta sin url llega como cadena vacía', () => {
    const sinUrl = { ...PERFIL, ofertas: [{ nombre: 'Tour', descripcion: 'Visita al terreno' }] }
    expect(desdeElPerfil(sinUrl).ofertas[0]!.url).toBe('')
  })

  it('no revienta con un perfil incompleto ni con basura', () => {
    // Recibe `unknown` desde el servidor: un perfil viejo, la plantilla, o
    // algo corrupto. Su trabajo es cargar lo que se pueda, no validar — de
    // eso responde el esquema al guardar.
    expect(() => desdeElPerfil({})).not.toThrow()
    expect(() => desdeElPerfil(null)).not.toThrow()
    expect(desdeElPerfil({}).pilares).toHaveLength(2)
    expect(desdeElPerfil({ posicionamiento: { categoria: 'Algo' } }).posicionamiento.categoria)
      .toBe('Algo')
  })
})

describe('haciaElPerfil', () => {
  it('convierte los porcentajes a proporciones', () => {
    const f = { ...FORMULARIO_VACIO, pilares: [
      { nombre: 'educacion', descripcion: 'Enseña', porcentaje: 33 },
      { nombre: 'producto', descripcion: 'Vende', porcentaje: 33 },
      { nombre: 'prueba', descripcion: 'Prueba', porcentaje: 34 },
    ] }
    const salida = haciaElPerfil(f) as { pilares: { proporcion: number }[] }
    expect(salida.pilares.map((p) => p.proporcion)).toEqual([0.33, 0.33, 0.34])
    // Y suman exactamente 1, que es lo que el esquema exige.
    expect(salida.pilares.reduce((t, p) => t + p.proporcion, 0)).toBeCloseTo(1, 10)
  })

  it('una url vacía OMITE la clave, no manda cadena vacía', () => {
    // El esquema declara `url` opcional pero con forma de URL: una cadena
    // vacía se rechaza, la ausencia se acepta. Es el borde más probable de
    // todo el bloque.
    const f = { ...FORMULARIO_VACIO, ofertas: [{ nombre: 'Tour', descripcion: 'Visita', url: '' }] }
    const salida = haciaElPerfil(f) as { ofertas: Record<string, unknown>[] }
    expect(Object.hasOwn(salida.ofertas[0]!, 'url')).toBe(false)
  })

  it('convierte el nombre del pilar a snake_case', () => {
    const f = { ...FORMULARIO_VACIO, pilares: [
      { nombre: 'Prueba de manejo', descripcion: 'Algo', porcentaje: 50 },
      { nombre: 'Postventa', descripcion: 'Algo', porcentaje: 50 },
    ] }
    const salida = haciaElPerfil(f) as { pilares: { nombre: string }[] }
    expect(salida.pilares.map((p) => p.nombre)).toEqual(['prueba_de_manejo', 'postventa'])
  })

  it('descarta los elementos de lista que quedaron vacíos', () => {
    // El formulario arranca listas con una fila vacía. Mandarla produciría
    // un error del esquema sobre un elemento que la persona nunca llenó.
    const f = {
      ...FORMULARIO_VACIO,
      posicionamiento: { categoria: 'Algo', promesa: 'Una promesa larga', diferenciadores: ['Uno', '', '  '] },
    }
    const salida = haciaElPerfil(f) as { posicionamiento: { diferenciadores: string[] } }
    expect(salida.posicionamiento.diferenciadores).toEqual(['Uno'])
  })
})

describe('aSnakeCase', () => {
  it('minúsculas, sin acentos, con guiones bajos', () => {
    expect(aSnakeCase('Prueba de Manejo')).toBe('prueba_de_manejo')
    expect(aSnakeCase('Educación')).toBe('educacion')
    expect(aSnakeCase('  postventa  ')).toBe('postventa')
    expect(aSnakeCase('A/B testing')).toBe('a_b_testing')
  })

  it('lo que no se puede convertir devuelve cadena vacía', () => {
    // El esquema exige que empiece con una letra. Un nombre que empieza con
    // dígito o que queda vacío no se puede adivinar: el campo lo marca.
    expect(aSnakeCase('123')).toBe('')
    expect(aSnakeCase('!!!')).toBe('')
    expect(aSnakeCase('')).toBe('')
  })
})
```

- [ ] **Paso 2: correr y ver que fallan**

```bash
pnpm --filter @gc/web test -- conversion
```

Esperado: FALLAN todas con `Failed to resolve import "./conversion.js"`.

- [ ] **Paso 3: escribir el módulo**

Crea `apps/web/src/componentes/perfil/conversion.ts`. Los puntos que no se pueden improvisar:

**`aSnakeCase`**: pasa a minúsculas, quita acentos con `normalize('NFD').replace(/[̀-ͯ]/g, '')`, reemplaza todo lo que no sea `a-z0-9` por `_`, colapsa los `_` repetidos y recorta los de los extremos. Si el resultado no cumple `/^[a-z][a-z0-9_]*$/`, devuelve `''`.

**`FORMULARIO_VACIO`**: todos los textos en `''`; `diferenciadores`, `atributos`, `hacer`, `noHacer` con **un** elemento vacío; `preferido`, `prohibido`, `disclaimers`, `ofertas` como listas **vacías**; `publicos` con **un** elemento de campos vacíos; `pilares` con **dos** elementos de campos vacíos y `porcentaje` 50 cada uno.

Que las listas opcionales arranquen vacías y las obligatorias con una fila es deliberado: no se le pide a nadie que llene lo que puede omitir.

**`desdeElPerfil`**: navega el objeto con defensa —cada acceso cae a su valor de `FORMULARIO_VACIO` si falta o no tiene el tipo esperado— y nunca lanza. `porcentaje: Math.round(proporcion * 100)`. `url: oferta.url ?? ''`. Una lista obligatoria que llegue vacía se rellena con una fila vacía, para que el formulario tenga dónde escribir.

**`haciaElPerfil`**: descarta de cada lista de textos los elementos que quedan vacíos tras `trim()`; descarta los elementos de `publicos`, `pilares` y `ofertas` cuyos campos estén **todos** vacíos; recorta con `trim()` todos los textos; convierte `porcentaje / 100`; aplica `aSnakeCase` al nombre del pilar; y **omite la clave `url`** cuando la cadena queda vacía tras recortar.

**Cuidado con el redondeo de la proporción.** `33 / 100` da `0.33` exacto en coma flotante, pero acumular tres de ellos puede dar `0.9999999999999999`. `validarPerfil` tolera 0,01, así que pasa — pero para que la prueba de la suma sea estable, calcula cada proporción como `porcentaje / 100` y no como una división acumulada.

- [ ] **Paso 4: correr y ver que pasan**

```bash
pnpm --filter @gc/web test -- conversion
```

Esperado: PASAN las once.

- [ ] **Paso 5: mutar y confirmar que se ponen rojas**

Tres mutaciones, una por una, deshaciendo cada una antes de la siguiente:

1. Que `haciaElPerfil` **incluya** `url: ''` en vez de omitirla → tiene que fallar `'una url vacía OMITE la clave'`.
2. Que `haciaElPerfil` **no** aplique `aSnakeCase` → tiene que fallar la prueba del `snake_case` **y** la de ida y vuelta no, porque el perfil de prueba ya viene en `snake_case`. Que la de ida y vuelta **no** se ponga roja es lo esperado y conviene verlo: prueba que las dos miden cosas distintas.
3. Que `desdeElPerfil` lance ante `{}` → tiene que fallar `'no revienta con un perfil incompleto'`.

Si alguna no se pone roja, la prueba no cubre lo que dice y hay que arreglarla antes de seguir.

- [ ] **Paso 6: la suite y el typecheck**

```bash
pnpm test && pnpm -r typecheck
```

- [ ] **Paso 7: commit**

```bash
git add apps/web/src/componentes/perfil/ && git commit -m "feat(web): conversión entre el formulario del perfil y el JSON del esquema"
```

---

## Task 2: las primitivas del formulario

**Archivos:**
- Crear: `apps/web/src/componentes/perfil/ejemplos.ts`
- Crear: `apps/web/src/componentes/perfil/campos.tsx`
- Crear: `apps/web/src/componentes/perfil/campos.test.tsx`

**Interfaces:**
- Consume: nada de Task 1 (las primitivas son genéricas sobre textos).
- Produce, y lo consumen las Tasks 3 y 4:

```ts
export function CampoDeTexto(props: {
  etiqueta: string
  ayuda: string
  ejemplo: string
  valor: string
  alCambiar: (v: string) => void
  largo?: boolean          // renderiza <textarea> en vez de <input>
}): JSX.Element

export function ListaDeTextos(props: {
  etiqueta: string
  ayuda: string
  ejemplo: string
  valores: string[]
  alCambiar: (v: string[]) => void
  minimo?: number          // por omisión 0; con 1, no se puede quitar el último
}): JSX.Element
```

**Por qué existen:** siete secciones con componentes a medida serían siete copias casi iguales. Estas dos cubren cinco de las siete.

- [ ] **Paso 1: escribir `ejemplos.ts`**

Un objeto con los textos de ayuda y ejemplo de cada campo, en español, **copiados como literales** —`apps/web` no declara `@gc/brand` y no debe declararlo—. Los ejemplos salen del perfil real de `parcelas` (`perfiles/parcelas.json`), reescritos para que quepan en una línea junto a su campo.

Vive en su propio archivo para que ajustar un texto no obligue a tocar un componente, y para que se puedan leer todos juntos y comprobar que hablan el mismo idioma.

- [ ] **Paso 2: escribir las pruebas que fallan**

Crea `apps/web/src/componentes/perfil/campos.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CampoDeTexto, ListaDeTextos } from './campos.js'

afterEach(cleanup)

describe('CampoDeTexto', () => {
  it('muestra la etiqueta, la ayuda y el ejemplo, y avisa cada cambio', async () => {
    const alCambiar = vi.fn()
    render(
      <CampoDeTexto
        etiqueta="Categoría"
        ayuda="En qué categoría compite"
        ejemplo="Venta de parcelas de agrado"
        valor=""
        alCambiar={alCambiar}
      />,
    )

    expect(screen.queryByText('En qué categoría compite')).not.toBeNull()
    expect(screen.queryByText(/Venta de parcelas de agrado/)).not.toBeNull()

    await userEvent.type(screen.getByLabelText('Categoría'), 'A')
    expect(alCambiar).toHaveBeenCalledWith('A')
  })
})

describe('ListaDeTextos', () => {
  it('agregar suma una fila vacía', async () => {
    const alCambiar = vi.fn()
    render(
      <ListaDeTextos
        etiqueta="Diferenciadores"
        ayuda="En qué es distinta"
        ejemplo="Factibilidad verificada"
        valores={['Uno']}
        alCambiar={alCambiar}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Agregar diferenciadores' }))
    expect(alCambiar).toHaveBeenCalledWith(['Uno', ''])
  })

  it('quitar saca la fila que corresponde y no otra', async () => {
    // La aserción importa: con `toHaveBeenCalled` a secas, un botón que
    // siempre quitara el primero pasaría igual.
    const alCambiar = vi.fn()
    render(
      <ListaDeTextos
        etiqueta="Diferenciadores"
        ayuda="En qué es distinta"
        ejemplo="Factibilidad verificada"
        valores={['Uno', 'Dos', 'Tres']}
        alCambiar={alCambiar}
      />,
    )

    await userEvent.click(screen.getAllByRole('button', { name: /^Quitar/ })[1]!)
    expect(alCambiar).toHaveBeenCalledWith(['Uno', 'Tres'])
  })

  it('con el mínimo alcanzado no se puede quitar', () => {
    // Es propiedad del control, no una copia de una regla del esquema:
    // borrar el último dejaría un formulario que no se puede guardar.
    render(
      <ListaDeTextos
        etiqueta="Atributos"
        ayuda="Cómo suena la marca"
        ejemplo="claro"
        valores={['claro']}
        alCambiar={vi.fn()}
        minimo={1}
      />,
    )

    expect(screen.queryAllByRole('button', { name: /^Quitar/ })).toHaveLength(0)
  })
})
```

- [ ] **Paso 3: correr y ver que fallan**

```bash
pnpm --filter @gc/web test -- campos
```

Esperado: FALLAN las cuatro con `Failed to resolve import "./campos.js"`.

- [ ] **Paso 4: escribir las primitivas**

Crea `apps/web/src/componentes/perfil/campos.tsx`, con `'use client'` en la primera línea.

Requisitos que las pruebas fijan y que hay que respetar:

- La etiqueta se asocia al control con `htmlFor`/`id`, para que `getByLabelText` lo encuentre. Genera el `id` con el hook `useId` de React.
- El ejemplo se muestra visible bajo el campo con el prefijo `Ejemplo: `, no como `placeholder`: un `placeholder` desaparece al escribir, y el ejemplo sirve justamente mientras se escribe.
- El texto de la plantilla —lo que hoy viene como valor— sí va como `placeholder`.
- El botón de agregar se llama `Agregar {etiqueta en minúsculas}` y el de quitar empieza con `Quitar`, para que las pruebas los distingan por nombre accesible.
- Estilos con las clases de Tailwind que ya usa `EditorDePerfil.tsx`: bordes `border-gray-300`, texto `text-sm`, el botón principal `bg-indigo-600`.

- [ ] **Paso 5: correr y ver que pasan**

```bash
pnpm --filter @gc/web test -- campos
```

- [ ] **Paso 6: mutar y confirmar**

Haz que el botón de quitar saque siempre el índice `0`. **Tiene que fallar** `'quitar saca la fila que corresponde y no otra'`. Deshaz.

- [ ] **Paso 7: la suite, el typecheck y commit**

```bash
pnpm test && pnpm -r typecheck
```

```bash
git add apps/web/src/componentes/perfil/ && git commit -m "feat(web): primitivas de campo y lista para el formulario de perfil"
```

---

## Task 3: las seis secciones que componen primitivas

**Archivos:**
- Crear: `apps/web/src/componentes/perfil/secciones.tsx`
- Crear: `apps/web/src/componentes/perfil/secciones.test.tsx`

**Interfaces:**
- Consume: `CampoDeTexto` y `ListaDeTextos` de `./campos.js` (Task 2), y los tipos `PerfilEnFormulario`, `PublicoEnFormulario`, `OfertaEnFormulario` de `./conversion.js` (Task 1).
- Produce, y lo consume Task 5:

```ts
export function SeccionPosicionamiento(props: {
  valor: PerfilEnFormulario['posicionamiento']
  alCambiar: (v: PerfilEnFormulario['posicionamiento']) => void
}): JSX.Element

export function SeccionPublicos(props: {
  valor: PublicoEnFormulario[]
  alCambiar: (v: PublicoEnFormulario[]) => void
}): JSX.Element

export function SeccionTono(props: {
  valor: PerfilEnFormulario['tono']
  alCambiar: (v: PerfilEnFormulario['tono']) => void
}): JSX.Element

export function SeccionLexico(props: {
  valor: PerfilEnFormulario['lexico']
  alCambiar: (v: PerfilEnFormulario['lexico']) => void
}): JSX.Element

export function SeccionOfertas(props: {
  valor: OfertaEnFormulario[]
  alCambiar: (v: OfertaEnFormulario[]) => void
}): JSX.Element

export function SeccionRestricciones(props: {
  valor: PerfilEnFormulario['restricciones']
  alCambiar: (v: PerfilEnFormulario['restricciones']) => void
}): JSX.Element
```

Cada una recibe su rebanada del formulario y devuelve la rebanada modificada. **Ninguna conoce el perfil entero**: eso las hace probables por separado y evita que una sección pise otra.

- [ ] **Paso 1: escribir las pruebas que fallan**

Crea `apps/web/src/componentes/perfil/secciones.test.tsx`. Cubre lo que distingue a estas secciones de las primitivas que ya están probadas — **no repitas las pruebas de `campos.test.tsx`**:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SeccionPublicos, SeccionOfertas, SeccionPosicionamiento } from './secciones.js'

afterEach(cleanup)

describe('SeccionPosicionamiento', () => {
  it('cambiar la categoría no borra la promesa', async () => {
    // Cada sección devuelve su rebanada ENTERA. Una que reconstruya el
    // objeto olvidando un campo lo borraría en silencio, y eso no lo vería
    // ninguna prueba de las primitivas.
    const alCambiar = vi.fn()
    render(
      <SeccionPosicionamiento
        valor={{ categoria: 'Vieja', promesa: 'Una promesa larga', diferenciadores: ['Uno'] }}
        alCambiar={alCambiar}
      />,
    )

    await userEvent.type(screen.getByLabelText('Categoría'), 'X')
    expect(alCambiar).toHaveBeenCalledWith({
      categoria: 'ViejaX',
      promesa: 'Una promesa larga',
      diferenciadores: ['Uno'],
    })
  })
})

describe('SeccionPublicos', () => {
  it('editar un público no toca a los demás', async () => {
    const alCambiar = vi.fn()
    render(
      <SeccionPublicos
        valor={[
          { nombre: 'Uno', dolor: 'Dolor uno largo', objecion: 'Objeción uno larga' },
          { nombre: 'Dos', dolor: 'Dolor dos largo', objecion: 'Objeción dos larga' },
        ]}
        alCambiar={alCambiar}
      />,
    )

    await userEvent.type(screen.getAllByLabelText('Nombre')[1]!, 'X')
    expect(alCambiar).toHaveBeenCalledWith([
      { nombre: 'Uno', dolor: 'Dolor uno largo', objecion: 'Objeción uno larga' },
      { nombre: 'DosX', dolor: 'Dolor dos largo', objecion: 'Objeción dos larga' },
    ])
  })

  it('con un solo público no se puede quitar', () => {
    // El esquema exige al menos uno.
    render(
      <SeccionPublicos
        valor={[{ nombre: 'Uno', dolor: 'Dolor largo', objecion: 'Objeción larga' }]}
        alCambiar={vi.fn()}
      />,
    )
    expect(screen.queryAllByRole('button', { name: /^Quitar público/ })).toHaveLength(0)
  })
})

describe('SeccionOfertas', () => {
  it('arranca vacía y se puede agregar', async () => {
    // Las ofertas son opcionales: no se le pide a nadie llenar una fila que
    // puede omitir.
    const alCambiar = vi.fn()
    render(<SeccionOfertas valor={[]} alCambiar={alCambiar} />)

    expect(screen.queryAllByLabelText('Nombre')).toHaveLength(0)
    await userEvent.click(screen.getByRole('button', { name: /^Agregar oferta/ }))
    expect(alCambiar).toHaveBeenCalledWith([{ nombre: '', descripcion: '', url: '' }])
  })
})
```

- [ ] **Paso 2: correr y ver que fallan**

```bash
pnpm --filter @gc/web test -- secciones
```

Esperado: FALLAN las cuatro con `Failed to resolve import "./secciones.js"`.

- [ ] **Paso 3: escribir las secciones**

Crea `apps/web/src/componentes/perfil/secciones.tsx`, con `'use client'`.

Cada sección envuelve sus campos en un `<section>` con un `<h2>` que la nombra, y compone `CampoDeTexto` y `ListaDeTextos` con los textos de `ejemplos.ts`. Los mínimos que las pruebas exigen: `diferenciadores` y `atributos` con `minimo={1}`; `publicos` con al menos uno; `ofertas`, `lexico` y `disclaimers` sin mínimo.

**La promesa y las descripciones van con `largo` para que sean `textarea`**: son textos de varias líneas y un `input` de una línea invita a escribir menos de lo que hace falta.

Los botones de quitar de las listas de objetos se llaman `Quitar público N` y `Quitar oferta N`, para que las pruebas los distingan.

- [ ] **Paso 4: correr, mutar y confirmar**

```bash
pnpm --filter @gc/web test -- secciones
```

Después, en `SeccionPosicionamiento`, haz que al cambiar la categoría devuelva `{ categoria }` sin el resto de la rebanada. **Tiene que fallar** `'cambiar la categoría no borra la promesa'`. Deshaz.

- [ ] **Paso 5: la suite, el typecheck y commit**

```bash
pnpm test && pnpm -r typecheck
```

```bash
git add apps/web/src/componentes/perfil/ && git commit -m "feat(web): las seis secciones del formulario de perfil"
```

---

## Task 4: los pilares

**Archivos:**
- Crear: `apps/web/src/componentes/perfil/Pilares.tsx`
- Crear: `apps/web/src/componentes/perfil/Pilares.test.tsx`

**Interfaces:**
- Consume: `CampoDeTexto` de `./campos.js` (Task 2); `PilarEnFormulario` y `aSnakeCase` de `./conversion.js` (Task 1).
- Produce, y lo consume Task 5:

```ts
export function SeccionPilares(props: {
  valor: PilarEnFormulario[]
  alCambiar: (v: PilarEnFormulario[]) => void
}): JSX.Element
```

**Va en archivo propio** porque es el único control con lógica de verdad —el total, la conversión visible del nombre, los repetidos— y mezclarlo con las seis secciones simples haría ese archivo el doble de largo por una sola sección.

- [ ] **Paso 1: escribir las pruebas que fallan**

Crea `apps/web/src/componentes/perfil/Pilares.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SeccionPilares } from './Pilares.js'

afterEach(cleanup)

const DOS = [
  { nombre: 'educacion', descripcion: 'Sobre qué enseña', porcentaje: 60 },
  { nombre: 'producto', descripcion: 'Qué vende', porcentaje: 40 },
]

describe('SeccionPilares', () => {
  it('cuando suma 100 lo dice sin alarma', () => {
    render(<SeccionPilares valor={DOS} alCambiar={vi.fn()} />)
    const total = screen.getByTestId('total-de-pilares')
    expect(total.textContent).toContain('100')
    expect(total.getAttribute('data-completo')).toBe('true')
  })

  it('cuando no suma 100 dice cuánto falta', () => {
    const corto = [{ ...DOS[0]!, porcentaje: 30 }, DOS[1]!]
    render(<SeccionPilares valor={corto} alCambiar={vi.fn()} />)
    const total = screen.getByTestId('total-de-pilares')
    expect(total.getAttribute('data-completo')).toBe('false')
    // No basta con avisar que está mal: hay que decir cuánto falta, o la
    // persona tiene que hacer la resta a mano.
    expect(total.textContent).toContain('30')
  })

  it('muestra cómo va a quedar guardado el nombre', async () => {
    const alCambiar = vi.fn()
    render(<SeccionPilares valor={DOS} alCambiar={alCambiar} />)

    const nombre = screen.getAllByLabelText('Nombre del pilar')[0]!
    await userEvent.clear(nombre)
    await userEvent.type(nombre, 'Prueba de manejo')

    expect(screen.queryByText(/prueba_de_manejo/)).not.toBeNull()
  })

  it('marca un nombre que no se puede convertir', async () => {
    render(
      <SeccionPilares
        valor={[{ nombre: '123', descripcion: 'Algo', porcentaje: 50 }, DOS[1]!]}
        alCambiar={vi.fn()}
      />,
    )
    expect(screen.getByRole('alert').textContent).toMatch(/empezar con una letra/i)
  })

  it('marca los nombres repetidos', () => {
    render(
      <SeccionPilares
        valor={[
          { nombre: 'educacion', descripcion: 'Uno', porcentaje: 50 },
          { nombre: 'Educación', descripcion: 'Dos', porcentaje: 50 },
        ]}
        alCambiar={vi.fn()}
      />,
    )
    // Los dos se convierten a `educacion`: el choque no es visible en lo que
    // la persona escribió, solo en lo que se va a guardar.
    expect(screen.getByRole('alert').textContent).toMatch(/repetido/i)
  })

  it('con dos pilares no se puede quitar ninguno', () => {
    render(<SeccionPilares valor={DOS} alCambiar={vi.fn()} />)
    expect(screen.queryAllByRole('button', { name: /^Quitar pilar/ })).toHaveLength(0)
  })

  it('con tres sí se puede, y quita el que corresponde', async () => {
    const alCambiar = vi.fn()
    const tres = [...DOS, { nombre: 'postventa', descripcion: 'Después', porcentaje: 0 }]
    render(<SeccionPilares valor={tres} alCambiar={alCambiar} />)

    await userEvent.click(screen.getAllByRole('button', { name: /^Quitar pilar/ })[1]!)
    expect(alCambiar).toHaveBeenCalledWith([DOS[0], tres[2]])
  })
})
```

- [ ] **Paso 2: correr y ver que fallan**

```bash
pnpm --filter @gc/web test -- Pilares
```

Esperado: FALLAN las siete.

- [ ] **Paso 3: escribir el control**

Crea `apps/web/src/componentes/perfil/Pilares.tsx`, con `'use client'`.

Lo que las pruebas fijan:

- Cada fila: nombre (`aria-label` exacto `Nombre del pilar`), descripción, y un `<input type="number">` para el porcentaje.
- **Bajo el campo de nombre, la conversión en vivo**: `→ prueba_de_manejo`. Si `aSnakeCase` devuelve `''`, en su lugar un aviso con `role="alert"` que diga que **tiene que empezar con una letra**.
- **Los repetidos**: se comparan los nombres ya convertidos; si hay choque, un aviso con `role="alert"` que use la palabra «repetido».
- **El total** en un elemento con `data-testid="total-de-pilares"` y un atributo `data-completo` que vale `"true"` solo cuando suma exactamente 100. El texto dice el total y, cuando no es 100, **cuánto falta o cuánto sobra**.
- **Quitar** solo aparece con más de dos pilares. **Agregar** suma una fila con porcentaje 0 — y no reparte automáticamente: repartir cambiaría números que la persona escribió a mano, que es peor que pedirle que ajuste.

El `data-completo` va como atributo y no solo como color porque un color no se puede afirmar en una prueba sin acoplarla a una clase de Tailwind, que cambia con cualquier retoque visual.

- [ ] **Paso 4: correr y ver que pasan**

```bash
pnpm --filter @gc/web test -- Pilares
```

- [ ] **Paso 5: mutar y confirmar**

Tres mutaciones, una a la vez, deshaciendo cada una antes de la siguiente:

1. Que `data-completo` valga siempre `"true"` → tiene que fallar `'cuando no suma 100 dice cuánto falta'`.
2. Que el texto del total muestre **solo** el total, sin cuánto falta → tiene que fallar la misma prueba, ahora por la aserción del `30`. Que las dos mutaciones rompan la misma prueba por razones distintas es lo que confirma que sus dos aserciones miden cosas distintas.
3. Que la detección de repetidos compare los nombres **sin** convertir → tiene que fallar `'marca los nombres repetidos'`, porque `educacion` y `Educación` son distintos sin convertir y solo chocan después de la conversión.

- [ ] **Paso 6: la suite, el typecheck y commit**

```bash
pnpm test && pnpm -r typecheck
```

```bash
git add apps/web/src/componentes/perfil/ && git commit -m "feat(web): el control de pilares, con total en vivo y snake_case a la vista"
```

---

## Task 5: el orquestador

**Archivos:**
- Modificar: `apps/web/src/componentes/EditorDePerfil.tsx` (reemplazo completo)
- Modificar: `apps/web/src/componentes/EditorDePerfil.test.tsx`
- Modificar: `apps/web/src/app/(app)/[marca]/perfil/page.tsx`

**Interfaces:**
- Consume: todo lo anterior — `desdeElPerfil`, `haciaElPerfil`, `PerfilEnFormulario` de `./perfil/conversion.js`; las seis secciones de `./perfil/secciones.js`; `SeccionPilares` de `./perfil/Pilares.js`.
- Produce: `EditorDePerfil` con **la misma firma de props que hoy** — `{ marca, version, perfil, versiones }`. La página no cambia de contrato.

- [ ] **Paso 1: adaptar las tres pruebas existentes y agregar las nuevas**

Las tres pruebas de `EditorDePerfil.test.tsx` siguen siendo válidas —la versión que se anuncia, el error del dominio, el reintento— pero su `PROPS.perfil` es `{ pilares: [] }`, que ya no basta. Cámbialo por un perfil completo, y agrega:

```tsx
  it('guarda el JSON del esquema, no el estado del formulario', async () => {
    // La garantía que une todo el bloque: lo que viaja a la Server Action
    // tiene la forma que el esquema espera —proporciones, no porcentajes—
    // y no la forma cómoda de editar.
    render(<EditorDePerfil {...PROPS} />)
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    const [, texto] = vi.mocked(guardarPerfilAction).mock.calls[0]!
    const enviado = JSON.parse(texto)
    expect(enviado.pilares[0].proporcion).toBe(0.6)
    expect(enviado.pilares[0].porcentaje).toBeUndefined()
  })

  it('la sección avanzada muestra el JSON del estado actual', async () => {
    render(<EditorDePerfil {...PROPS} />)
    await userEvent.click(screen.getByRole('button', { name: /Avanzado/ }))

    const area = screen.getByLabelText('Perfil de marca en formato JSON')
    expect(JSON.parse((area as HTMLTextAreaElement).value).pilares[0].proporcion).toBe(0.6)
  })
```

- [ ] **Paso 2: correr y ver que fallan**

```bash
pnpm --filter @gc/web test -- EditorDePerfil
```

Esperado: FALLAN las dos nuevas.

- [ ] **Paso 3: reescribir el orquestador**

`EditorDePerfil.tsx` conserva **toda** su lógica de guardado: el estado `ocupado`, el `error` con su `reintentable`, el `versionGuardada` que sale del retorno de la acción y no de la prop, y el historial de versiones en su costado.

Lo que cambia es qué hay en el medio:

- El estado pasa de `texto: string` a `formulario: PerfilEnFormulario`, inicializado con `desdeElPerfil(perfil)`.
- Al guardar, `guardarPerfilAction(marca, JSON.stringify(haciaElPerfil(formulario), null, 2))`.
- Las siete secciones, cada una con su rebanada y su `alCambiar`.
- Al final, un `<details>` con `<summary>Avanzado: ver o pegar el JSON</summary>`, que contiene un `textarea` con `aria-label="Perfil de marca en formato JSON"` —el mismo de hoy, para no romper nada que lo busque— mostrando `JSON.stringify(haciaElPerfil(formulario), null, 2)`, más un botón `Cargar este JSON en el formulario`. Ese botón parsea; si falla, muestra el error y **no toca el formulario**.

**Conserva el comentario de cabecera que explica por qué `versionGuardada` sale del retorno de la acción**: sigue siendo cierto y sigue siendo no obvio.

- [ ] **Paso 4: el aviso del estado vacío en la página**

En `apps/web/src/app/(app)/[marca]/perfil/page.tsx`, el aviso amarillo dice hoy «Reemplaza el texto de la plantilla por el de la marca». Con campos vacíos eso dejó de ser cierto. Reemplázalo por un texto que diga que la marca todavía no tiene perfil, que sin él no se puede generar ni la estrategia ni la grilla, y que al guardar se crea la versión 1.

El comentario que hay encima explica la decisión anterior. **Actualízalo** para que describa la nueva: los textos de la plantilla ahora son marcadores de posición dentro de cada campo, y la guarda de «plantilla sin cambios» de `cargarPerfilDeObjeto` deja de dispararse por este camino pero se conserva para el CLI.

- [ ] **Paso 5: correr y ver que pasan**

```bash
pnpm --filter @gc/web test -- EditorDePerfil
```

- [ ] **Paso 6: mutar y confirmar**

Haz que el guardado mande `JSON.stringify(formulario)` en vez de pasar por `haciaElPerfil`. **Tiene que fallar** `'guarda el JSON del esquema, no el estado del formulario'`. Deshaz.

- [ ] **Paso 7: la suite, el typecheck, el build y commit**

```bash
pnpm test && pnpm -r typecheck && pnpm --filter @gc/web build
```

El build tiene que seguir mostrando las cuatro rutas del dominio con `ƒ` y no con `○`.

```bash
git add apps/web/src/ && git commit -m "feat(web): el perfil se edita con un formulario, no con JSON"
```

---

## Task 6: la verificación que ninguna prueba reemplaza

**No escribe código de producción.** Es la comprobación que decide si el bloque cumplió su objetivo.

- [ ] **Paso 1: levantar la web contra la base local**

```bash
docker compose up -d postgres
```

```bash
pnpm --filter @gc/web dev
```

- [ ] **Paso 2: llenar el perfil de una marca nueva, de principio a fin**

Crea una marca de prueba desde la pantalla raíz y llena su perfil **entero** usando solo el formulario, sin abrir la sección avanzada. Cronométralo.

Lo que hay que responder, y con honestidad:

- ¿Se entiende qué va en cada campo **sin** leer documentación?
- ¿El total de los pilares se comporta como uno espera al ajustar los números?
- ¿La conversión del nombre a `snake_case` sorprende, o se ve venir?
- ¿Cuánto tardó, contra lo que habría tardado escribiendo el JSON?

**Si la respuesta a la primera es que no, el bloque falló** aunque las pruebas estén verdes, y lo que hay que arreglar son los textos de `ejemplos.ts`, no el código.

- [ ] **Paso 3: la ida y vuelta, en el navegador**

Abre el perfil de `parcelas`, que ya tiene uno cargado. **Sin tocar nada**, abre la sección avanzada y compara el JSON que muestra contra `perfiles/parcelas.json`. Tienen que ser equivalentes.

Es la misma garantía que afirma la prueba central de la Task 1, comprobada por el otro camino: si un campo se perdiera solo al pasar por los componentes, la prueba de conversión no lo vería.

- [ ] **Paso 4: la salida de emergencia**

Pega un perfil completo en la sección avanzada y comprueba que los campos se llenan. Pega algo que no sea JSON y comprueba que aparece el error **y que el formulario no se vacía**.

- [ ] **Paso 5: restaurar la base de desarrollo**

Borra la marca de prueba. `CLAUDE.md` pide preservar la marca `parcelas` con su perfil, la estrategia `2026-Q3` y la grilla de `2026-09` en borrador.

- [ ] **Paso 6: anotar lo que salga**

Si el paso 2 encontró textos confusos, arréglalos en `ejemplos.ts` y commitea. Si encontró algo estructural, anótalo en `docs/superpowers/specs/pendientes.md` en vez de arreglarlo sobre la marcha.

---

## Autorrevisión de este plan

**Cobertura del spec:**

| Sección del spec | Tarea |
|---|---|
| La pantalla, siete secciones en orden | Tasks 3, 4, 5 |
| Etiqueta, ayuda y ejemplo por campo | Task 2 (`ejemplos.ts`), Task 3 |
| Mínimos de lista respetados al quitar | Tasks 2, 3, 4 |
| Pilares: porcentajes enteros y total en vivo | Task 4 |
| Pilares: `snake_case` a la vista, repetidos | Task 4 |
| El esquema como única autoridad | Restricciones globales, y ninguna tarea declara mínimos de longitud |
| La salida de emergencia plegada | Task 5 |
| Ida y vuelta sin pérdida | Task 1 (la prueba central) y Task 6 paso 3 |
| `ofertas[].url` opcional | Task 1 |
| Estructura en primitivas más secciones | Tasks 2, 3, 4 |
| Verificación en el navegador | Task 6 |

Sin huecos.

**Consistencia de nombres**, comprobada de punta a punta: `PerfilEnFormulario`, `PilarEnFormulario`, `PublicoEnFormulario`, `OfertaEnFormulario`, `FORMULARIO_VACIO`, `aSnakeCase`, `desdeElPerfil`, `haciaElPerfil` se producen en Task 1 y se consumen con esos mismos nombres en 2, 3, 4 y 5. `CampoDeTexto` y `ListaDeTextos` se producen en Task 2 y se consumen en 3 y 4. Las seis secciones y `SeccionPilares` se producen en 3 y 4 y se consumen en 5. El `aria-label` del `textarea` avanzado es el mismo que usa el editor de hoy.

**El campo `porcentaje` nunca cruza la frontera**: existe solo dentro de `PerfilEnFormulario` y `haciaElPerfil` lo convierte. La prueba de la Task 5 lo afirma explícitamente.
