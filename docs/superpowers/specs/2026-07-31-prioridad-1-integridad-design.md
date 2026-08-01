# Integridad: errores, multi-tenencia y selección de estrategia — Diseño

**Fecha:** 2026-07-31
**Estado:** Aprobado para planificación
**Origen:** los tres puntos de Prioridad 1 de [pendientes tras la Fase 0](pendientes.md)
**Alcance:** `@gc/shared`, `@gc/db`, `@gc/strategy` y `apps/cli`. Una migración.

---

## 1. Por qué ahora

Los tres defectos comparten una propiedad: **son baratos hoy y caros después**. Ninguno rompe el sistema con una sola organización, un solo trimestre y una base de datos local que nunca se cae. Los tres se vuelven costosos en cuanto la Fase 1 monte una interfaz encima: uno exige una migración con datos productivos, otro convierte fallas transitorias en pérdidas de dinero, y el tercero produce contenido silenciosamente equivocado.

**No es objetivo** arreglar la Prioridad 2 ni adelantar trabajo de la Fase 1.

---

## 2. Decisiones tomadas

| Decisión | Elección | Razón |
|---|---|---|
| Alcance de la integridad multi-tenant | **Cadena completa de FK compuestas** | Cierra el agujero entero mientras cuesta una migración sin datos |
| Selección de estrategia en P2 | **Estricta: el trimestre debe calzar** | Elimina la clase "usó la estrategia equivocada en silencio", en vez de avisarla |
| Dónde clasificar los errores de la base | **En el punto de decisión, no en cada llamada** | Ver §3 |
| Cómo elige el CLI la organización | Bandera `--org`, luego `ORGANIZACION`, luego la única que exista | Nunca elige por ti cuando hay ambigüedad |

---

## 3. Parte 1 — Clasificar los errores de Postgres

### El problema

`esTransitorio()` devuelve `false` para todo lo que no sea un `ErrorDeDominio`, y es el **único** punto donde el motor de pipeline decide si reintentar. Ninguna llamada a la base está envuelta. Un reinicio de conexión, un deadlock o una falla de serialización —transitorios de manual— se tratan como permanentes: sin reintento, corrida marcada `fallido`, y los tokens del modelo ya gastados sin recuperación posible.

Dos cambios recientes ensancharon esta superficie: ahora se escribe en `ai_calls` después de *cada* llamada al modelo, y `persistir` corre dentro de una transacción, que introduce precisamente las clases de error que hoy se malinterpretan.

### El enfoque descartado

Envolver cada llamada a la base en un `try/catch` que reclasifique. Son unas cuarenta llamadas repartidas en cuatro paquetes, y —lo decisivo— **no cubre la llamada número cuarenta y uno**: cada consulta que alguien escriba después nace sin protección y nada se lo recuerda.

### El enfoque elegido

Hacer más lista la clasificación en el único lugar donde ya se decide. En `@gc/shared`:

```ts
/** Códigos SQLSTATE que ameritan reintento. */
clasificarPostgres(codigo: string): ClaseDeError

/** Clasifica cualquier error: de dominio, de Postgres, o desconocido. */
clasificarError(e: unknown): ClaseDeError

/** Pasa a delegar en clasificarError. */
esTransitorio(e: unknown): boolean
```

`clasificarError` resuelve en cascada:

1. `ErrorDeDominio` → su propia `clase`
2. Objeto con una propiedad `code` que parezca SQLSTATE → `clasificarPostgres(code)`
3. Cualquier otra cosa → `permanente`

El tercer caso es deliberadamente conservador: un `TypeError` o un `RangeError` son bugs, y reintentar un bug solo lo repite.

### Códigos

| SQLSTATE | Significado | Clase |
|---|---|---|
| `40001` | Fallo de serialización | transitorio |
| `40P01` | Deadlock detectado | transitorio |
| `08000` `08003` `08006` `08001` `08004` | Excepciones de conexión | transitorio |
| `53300` | Demasiadas conexiones | transitorio |
| `55P03` | Lock no disponible | transitorio |
| `57P01` | Apagado administrativo | transitorio |
| `57014` | Consulta cancelada | transitorio |
| Todo lo demás | Única, foránea, `CHECK`, datos, sintaxis | permanente |

La clasificación por familia (`08*` como prefijo) se evita a propósito: una lista explícita es auditable y no arrastra códigos futuros por accidente.

### Mensajes legibles en el CLI

`clasificarError` decide si reintentar, pero no produce buenos mensajes. `crearMarca` captura la violación de única y la convierte en un error de dominio legible — hoy el usuario recibe el texto crudo del driver.

---

## 4. Parte 2 — Multi-tenencia exigible por la base

### El problema

Cada tabla lleva `organization_id`, pero es un valor que provee quien llama y que la base **nunca** contrasta contra el `brand_id` de la misma fila. Las claves foráneas son independientes: nada impide insertar un `plan_slot` con el `organization_id` de una organización y el `content_plan_id` de otra. Hoy la frontera se sostiene únicamente en que los identificadores son UUID inadivinables.

### La migración

**Restricciones únicas nuevas** (necesarias como destino de las FK compuestas; redundantes para unicidad, ya que `id` es la clave primaria):

- `brands (id, organization_id)`
- `content_plans (id, organization_id)`
- `pipeline_runs (id, organization_id)`
- `plan_slots (id, organization_id)`

**Claves foráneas compuestas** — reemplazan a las de una sola columna, no se suman:

| Tabla | Columnas | Destino |
|---|---|---|
| `brand_profiles` | `(brand_id, organization_id)` | `brands` |
| `channel_accounts` | `(brand_id, organization_id)` | `brands` |
| `approval_policies` | `(brand_id, organization_id)` | `brands` |
| `strategies` | `(brand_id, organization_id)` | `brands` |
| `content_plans` | `(brand_id, organization_id)` | `brands` |
| `pipeline_runs` | `(brand_id, organization_id)` | `brands` |
| `ai_calls` | `(brand_id, organization_id)` | `brands` |
| `ai_calls` | `(run_id, organization_id)` | `pipeline_runs` |
| `plan_slots` | `(content_plan_id, organization_id)` | `content_plans` |
| `plan_slots` | `(source_slot_id, organization_id)` | `plan_slots` |
| `pipeline_steps` | `(run_id, organization_id)` | `pipeline_runs` |

Donde la columna hija es nullable (`brand_id` en `pipeline_runs` y `ai_calls`, `run_id` en `ai_calls`, `source_slot_id` en `plan_slots`), Postgres no exige la clave cuando hay `NULL`. Es el comportamiento correcto y no requiere nada especial.

**Efecto secundario que vale la pena nombrar:** `plan_slots.source_slot_id` hoy **no tiene clave foránea alguna** — se declaró como un `uuid` suelto. La compuesta le da integridad referencial que nunca tuvo, con `ON DELETE CASCADE` como el resto.

### El `slug` de organización

`organizations` recibe una columna `slug` única, que el CLI necesita para nombrar una organización sin pedirle al usuario un UUID.

La tabla ya tiene datos en la base local, así que la migración va en tres pasos: agregar la columna nullable, rellenar (`UPDATE organizations SET slug = 'principal' WHERE slug IS NULL`), y recién entonces marcarla `NOT NULL` y única. Es la única parte de esta migración que toca datos existentes.

### Resolución de la organización en el CLI

En orden:

1. Bandera `--org <slug>`
2. Variable de entorno `ORGANIZACION`
3. La única organización que exista

Si hay más de una y no se especificó ninguna, **falla y lista los slugs disponibles**. Nunca elige por su cuenta: elegir en silencio es exactamente el defecto que este trabajo viene a cerrar.

Si no existe ninguna, se crea la organización por defecto como hoy, ahora con slug `principal`.

`resolverMarca` pasa a filtrar por `(organization_id, slug)`, que es la restricción única real de `brands`. Hoy filtra solo por `slug`, así que dos organizaciones con la marca `parcelas` se resolverían a una de las dos al azar.

---

## 5. Parte 3 — Estrategia por trimestre

### El problema

`cargarEstrategiaVigente` toma la estrategia más reciente por `created_at`, sin mirar periodo ni estado. Tres consecuencias:

- Una estrategia `archivada` —justo la que P1 se niega a pisar— es entrada perfectamente válida para P2.
- Como el upsert de P1 no toca `created_at`, "la más reciente" sigue la primera creación y no la última edición.
- Nada vincula un mes con un trimestre: la grilla de septiembre puede nacer de la estrategia de Q4.

Y esto empeoró con el último arreglo: la estrategia ahora decide, vía `mixDeCanales`, **qué derivados existen**. Elegir la equivocada ya no cambia solo el prompt — cambia en silencio la grilla que se persiste.

### La regla

```ts
trimestreDe('2026-09') → '2026-Q3'
```

`cargarEstrategiaVigente(db, brandId, mes)` exige `period = trimestreDe(mes)` y `status <> 'archivada'`. Si no hay, error permanente que nombra el periodo faltante:

> La marca no tiene estrategia vigente para 2026-Q3. Genérala antes de la grilla de 2026-09.

El costo operativo es real y aceptado: en octubre hay que generar la estrategia de Q4 antes que la grilla. Es el orden que el diseño original ya describe — P1 trimestral alimenta a P2 mensual — solo que ahora el código lo exige en vez de sugerirlo.

### Formato de periodo

P1 acepta hoy cualquier cosa como `--periodo`. Pasa a validar `AAAA-QN` con `N` entre 1 y 4, del mismo modo que `grilla:ver` ya valida el mes. Sin esto, `trimestreDe` produciría comparaciones que nunca calzan y el usuario recibiría "no hay estrategia" para una que sí generó, escrita con otro formato.

---

## 6. Pruebas

Cada parte con la prueba que la haría fallar si se revierte:

- **Clasificación:** una tabla de códigos SQLSTATE contra su clase esperada; que un `Error` plano y un `TypeError` salgan permanentes; y —la que importa— que el motor de pipeline **reintente** un paso que lanza un error con `code: '40001'` y **no** reintente uno con `code: '23505'`.
- **Multi-tenencia:** que la base rechace una fila hija cuyo `organization_id` no coincide con el de su padre, sobre al menos una tabla de cada nivel: hija de marca, nieta vía `content_plans`, y la autorreferencia de `plan_slots`.
- **Organización en el CLI:** que con dos organizaciones y sin bandera falle listando los slugs; que `--org` desempate; que dos marcas con el mismo slug en organizaciones distintas se resuelvan cada una a la suya.
- **Estrategia:** que `trimestreDe` cubra los doce meses; que una estrategia archivada no sea elegible; que una de otro trimestre no sea elegible; que el mensaje nombre el periodo faltante.

La prueba de humo del CLI debe seguir verde sin cambios de comportamiento: usa `2026-Q3` y `2026-09`, que ya calzan.

---

## 7. Riesgos

**La migración toca todas las tablas.** Es sin datos salvo por el `slug`, y la base local se puede recrear. El riesgo real es que drizzle-kit genere algo distinto de lo esperado al reemplazar claves foráneas: la migración se revisa a mano antes de aplicarse, y el esquema y el SQL generado deben coincidir columna por columna.

**La regla estricta de trimestre puede bloquear a un usuario** que no entienda por qué su grilla no se genera. Se mitiga con el mensaje, que nombra el periodo exacto a generar y el comando implícito.

**`clasificarError` es ahora un punto único de falla conceptual:** si clasifica mal, el error se propaga a todo el sistema. Por eso la lista de códigos es explícita y está cubierta por una tabla de pruebas, en vez de inferirse por prefijos.

---

## 8. Siguiente paso

Plan de implementación. Los ítems de Prioridad 2 siguen registrados en el documento de pendientes y no entran aquí.
