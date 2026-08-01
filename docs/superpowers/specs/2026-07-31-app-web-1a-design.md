# App web (bloque 1A) — Diseño

**Fecha:** 2026-07-31
**Estado:** Aprobado para planificación
**Alcance:** el primer bloque de la Fase 1. La app corre local contra la base existente. No incluye worker, agenda, autenticación ni despliegue.

---

## 1. Por qué este bloque y no la Fase 1 completa

La Fase 1 del [diseño general](2026-07-31-gestor-contenido-multimarca-design.md) son tres subsistemas: la app web, la automatización con worker y agenda, y el despliegue. Se separan porque **lo que más rápido dice si las pantallas son correctas es usarlas**, y esa validación es más barata antes de pagar el peaje de la infraestructura.

| Bloque | Entregable | Estado |
|---|---|---|
| **1A** | Apruebas una grilla en el navegador | Este documento |
| 1B | La grilla del mes se genera sola | Pendiente |
| 1C | Lo usas desde donde sea | Pendiente |

**No es objetivo:** autenticación, despliegue, disparar generación desde la web, editar fechas o canales de un slot, formularios por campo para el perfil de marca.

---

## 2. Decisiones tomadas

| Decisión | Elección | Razón |
|---|---|---|
| Dónde corre | **Local, sin autenticación** | Cero superficie de seguridad; llegamos a pantallas usables mucho antes |
| Trabajo largo | **La web no lo dispara** | Respeta la regla estructural del diseño sin inventar infraestructura |
| Edición de grilla | **Descartar slots y editar sus textos** | Cubre lo que uno hace revisando; cada cambio es una escritura simple sin revalidar |
| Perfil de marca | **Editor JSON con validación al guardar** | Cubre el esquema completo con una fracción del trabajo de un formulario |
| Forma de la app | **Server Components + Server Actions** | Un solo consumidor en el mismo proceso: cualquier capa intermedia es código sin usuarios |

---

## 3. El refactor que este bloque debe hacer bien

Las funciones de operación viven en `apps/cli/src/comandos.ts`. Una app no puede importar de otra app, así que se promueven a **`packages/operaciones`** y tanto `apps/cli` como `apps/web` las consumen desde ahí.

No es refactor gratuito: es lo que impide que la web reimplemente `resolverMarca`, `verGrilla` y compañía con sus propias sutilezas de organización. Dos superficies con dos implementaciones del mismo concepto discrepan, y la de tenencia ya costó una rama entera de arreglar.

El movimiento es mecánico — las firmas ya llevan `organizationId` explícito, que fue justamente el trabajo hecho para que esto fuera posible.

---

## 4. Rutas

| Ruta | Qué hace |
|---|---|
| `/` | Redirige a la marca más antigua por `created_at`, mes actual |
| `/[marca]/grilla/[mes]` | Calendario del mes, detalle de slot, descartar, editar, aprobar |
| `/[marca]/perfil` | Editor JSON con validación, historial de versiones |
| `/[marca]/estrategia` | Estrategia vigente del trimestre, solo lectura |

La marca va en la URL, no en estado global: compartes un enlace y cae donde debe. El selector del encabezado solo reescribe la ruta.

### El calendario

Rejilla del mes por semanas y días. Cada slot es una ficha con su canal, su pilar y su ángulo; los derivados se distinguen de sus padres; los descartados van atenuados y no cuentan en los totales que muestra la cabecera. Al pulsar una ficha se abre un panel lateral con el brief completo, el slot padre si es un derivado, y los botones de descartar y editar.

La cabecera muestra el estado del plan (`borrador`, `aprobada`, `en_ejecución`, `cerrada`), el conteo por canal, y los avisos que `validarGrilla` dejó registrados — cadencia y distribución de pilares. Aprobar solo está disponible en `borrador`.

---

## 5. Flujo de datos

**Lectura:** los Server Components consultan `@gc/db` directamente. Sin capa intermedia, sin serialización manual, sin estado de cliente para datos.

**Escritura:** cuatro Server Actions, todas contra `packages/operaciones`:

| Acción | Efecto |
|---|---|
| `descartarSlot` | `plan_slots.status = 'descartado'` |
| `editarSlot` | Actualiza `angle` y `brief` |
| `aprobarGrilla` | `content_plans.status = 'aprobada'` |
| `guardarPerfil` | Valida con `validarPerfil` y crea versión nueva |

Cada una revalida su ruta al terminar. Ninguna ejecuta trabajo largo ni llama al modelo.

**Consecuencia de descartar que hay que respetar:** un slot descartado no se borra, así que sigue existiendo para la clave foránea de sus derivados. Descartar un padre **no** descarta sus derivados automáticamente — la interfaz lo advierte y ofrece descartarlos también, pero son dos acciones, no una cascada implícita.

---

## 6. Stack

- **Next.js (App Router) con React**, dentro del workspace como `apps/web`.
- **Tailwind** para estilos, sin librería de componentes: tres pantallas no justifican el árbol de dependencias de un sistema de componentes, y agregarlo después no cuesta más que agregarlo ahora.
- **Vitest** para las acciones y los lectores, con el mismo `vitest.setup.ts` de la raíz y `fileParallelism: false` que el resto de los paquetes.
- **Un solo `.env`, en la raíz.** Next.js busca su propio `.env` en la carpeta de la app, así que `next.config.ts` carga explícitamente el de la raíz antes de exportar la configuración. Sin esto la app tendría su propia copia y volveríamos a un problema que este proyecto ya resolvió.
- **`.claude/launch.json`** con la configuración del servidor de desarrollo, para que la previsualización funcione sin adivinar puerto ni comando.

---

## 7. Errores

Todo el sistema lanza `ErrorDeDominio` con su `clase`. Las Server Actions lo capturan y devuelven `{ ok: false, mensaje }`; la interfaz lo muestra tal cual, porque los mensajes ya están en español, ya nombran la marca por su slug y ya explican el remedio.

La `clase` decide qué ofrece la interfaz: `transitorio` muestra un botón de reintentar, `permanente` no. Un error inesperado se trata como permanente, igual que en el motor.

---

## 8. Pruebas, y el hueco

Las Server Actions y los lectores son funciones sobre la base y se prueban como todo lo demás: contra Postgres real, con `conBaseDeDatosDePrueba`.

**El renderizado no se prueba.** El repositorio no tiene arnés de navegador y montar uno es un subsistema aparte. Queda registrado como hueco consciente y no como olvido: si una página deja de atenuar los slots descartados, ninguna prueba lo nota. La lógica que decide *qué* se muestra sí vive en funciones probadas; lo que queda sin cubrir es que el componente las use bien.

---

## 9. Riesgos

**El refactor a `packages/operaciones` toca el CLI, que hoy tiene 218 pruebas verdes detrás.** Es un movimiento mecánico, pero es el punto donde una firma mal propagada rompe algo que ya funcionaba. Se hace como primera tarea y con la suite completa como red.

**El editor JSON puede dejar un perfil inválido si la validación se salta.** No se salta: `guardarPerfil` ya valida y ya versiona, y la acción no hace nada que esquive esa ruta.

**Tres pantallas parecen poco trabajo y no lo son.** El calendario es la pieza sustancial: una rejilla de mes con fichas, panel de detalle y estados. Es donde este bloque se puede alargar, y por eso la edición de fechas y canales quedó explícitamente fuera.

---

## 10. Siguiente paso

Plan de implementación. Los bloques 1B y 1C conservan su propio ciclo de spec, plan e implementación.
