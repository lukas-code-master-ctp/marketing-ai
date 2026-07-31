# Gestor de contenido multimarca potenciado por IA — Diseño

**Fecha:** 2026-07-31
**Estado:** Aprobado para planificación
**Alcance de este documento:** arquitectura global del sistema completo. El plan de implementación que se derive de aquí cubre las **Fases 0 y 1**. Cada bloque posterior tendrá su propio spec.

---

## 1. Problema y objetivo

Tres startups, cada una con branding y posicionamiento propios, necesitan presencia sostenida en Instagram, LinkedIn, Facebook, TikTok y blog. Hacerlo a mano no escala: el cuello de botella no es la creatividad puntual sino la **consistencia** — mantener tres voces distintas, en cinco canales, todos los meses, sin que se degrade el tono ni se pierda el hilo estratégico.

**Objetivo:** un sistema que, partiendo del perfil de marca documentado de cada startup, produzca la estrategia, la grilla mensual, las piezas de contenido y su publicación, midiendo los resultados y realimentando la estrategia del mes siguiente.

**No es objetivo (por ahora):** publicidad pagada, gestión de comunidad (responder comentarios y DMs), CRM, ni gestión de influencers.

---

## 2. Decisiones fundacionales

| Decisión | Elección | Razón |
|---|---|---|
| Modelo de negocio | **Interno ahora, producto después** | Todo se modela con `organization → brand` desde el día 1. Evita una reescritura completa más adelante |
| Control humano | **Mixto, configurable por `(marca, canal)`** | Canales sensibles (LinkedIn, blog) con aprobación; canales de volumen en automático |
| Formatos | Copy, imágenes desde plantillas, imágenes por IA, video | Video se difiere a la Fase 6 por su tamaño; entra tras una interfaz de renderizador ya definida |
| Interfaz | **App web propia** (Next.js) | Único camino coherente con "producto después" |
| Infraestructura | **Vercel + Google Cloud** | Vercel para la app; GCP para BD, storage, workers y agenda. Vertex AI queda a mano para imágenes |
| Orquestación | **Híbrida** — esqueleto determinístico, nodos agénticos acotados | Determinismo donde toca el mundo exterior; flexibilidad donde aporta valor |
| Proveedor de IA | **OpenRouter** con enrutamiento por tarea | Permite usar el modelo caro donde importa y el barato donde hay volumen |

### La decisión de orquestación, en detalle

Se evaluaron tres enfoques:

- **A · Pipeline determinístico:** máquina de estados en código, IA en los nodos. Depurable y barato, pero rígido.
- **B · Agéntico puro:** un supervisor con herramientas decide todo. Flexible, pero no determinista, caro y difícil de auditar — inaceptable cuando tiene permiso de publicar en las cuentas reales de las empresas.
- **C · Híbrido (elegido):** esqueleto determinístico; nodos agénticos acotados y de **solo lectura** en los pasos creativos.

Se construye en orden: primero el esqueleto A completo y funcionando, después se abren los nodos agénticos. Así la parte impredecible es opcional en vez de estructural.

---

## 3. Arquitectura

```
┌─────────────────────────────────────────────────────────┐
│  Vercel — Next.js (App Router)                          │
│  · Dashboard, calendario editorial, bandeja de           │
│    aprobación, editor de piezas, reportes                │
│  · API routes: lectura/escritura rápida + encolado       │
└───────────────┬─────────────────────────────────────────┘
                │ Cloud Tasks
                ▼
┌─────────────────────────────────────────────────────────┐
│  Google Cloud Run — Worker de orquestación               │
│  · Ejecuta los pasos del pipeline (minutos, reintentos)  │
└───────────────┬─────────────────────────────────────────┘
     ┌──────────┼──────────────┬──────────────────┐
     ▼          ▼              ▼                  ▼
┌─────────┐ ┌────────┐  ┌─────────────┐  ┌──────────────┐
│Cloud SQL│ │  GCS   │  │ OpenRouter  │  │ Conectores   │
│Postgres │ │ assets │  │ + Vertex AI │  │ IG/LI/FB/TT  │
└─────────┘ └────────┘  └─────────────┘  └──────────────┘
                ▲
┌───────────────┴─────────────────────────────────────────┐
│  Cloud Scheduler — ciclos recurrentes                    │
└─────────────────────────────────────────────────────────┘
```

### Regla estructural

**Vercel nunca ejecuta trabajo largo.** Las API routes solo escriben en Postgres y encolan en Cloud Tasks. Todo lo que tarde más de un par de segundos vive en Cloud Run. Esto evita que un timeout deje una pieza a medio publicar en estado desconocido.

Los secretos (tokens de Meta, LinkedIn, TikTok) viven en **Google Secret Manager**. Cloud Run tiene acceso; Vercel no lo necesita porque Vercel nunca publica.

### Módulos

| Módulo | Responsabilidad única | Depende de |
|---|---|---|
| `core/brand` | Perfil de marca: cargar, validar, servir contexto | Postgres |
| `core/strategy` | Estrategia trimestral y grilla mensual | `brand`, `ai` |
| `core/content` | Briefs y generación de piezas por formato | `brand`, `ai`, `assets` |
| `core/assets` | Renderizado de imágenes y almacenamiento | GCS, Vertex |
| `core/publish` | Conectores por canal tras una interfaz común | — |
| `core/metrics` | Ingesta y normalización de métricas | `publish` |
| `core/ai` | OpenRouter, enrutamiento de modelos, validación de esquemas, costos | OpenRouter |
| `core/pipeline` | Máquina de estados, transiciones, reintentos | todos |
| `core/notify` | Alertas y notificaciones del modo asistido | — |

Dos fronteras son críticas:

- **`core/publish`** expone una sola interfaz. Cada red es una implementación detrás de ella. Cuando Meta cambie su API, se toca un archivo.
- **`core/ai`** es el único punto del sistema que habla con un modelo. Ningún otro módulo conoce OpenRouter ni nombres de modelos.

---

## 4. Modelo de datos

```
organization
   └── brand ─────────────┬──────────────┬──────────────┐
        ├── brand_profile  (versionado)                  │
        ├── channel_account                              │
        │        └── approval_policy                     │
        ├── strategy (trimestral)                        │
        │     └── content_plan (mensual)                 │
        │           └── plan_slot  ◄── source_slot_id ─┐ │
        │                 └── content_piece ───────────┘ │
        │                       ├── content_revision     │
        │                       ├── asset (GCS)          │
        │                       └── publication ─────────┘
        │                             └── metric_snapshot
        └── pipeline_run ── pipeline_step ── ai_call
```

Todas las tablas llevan `organization_id`.

| Tabla | Contenido | Nota de diseño |
|---|---|---|
| `organization` | Tenant raíz | Existe desde el día 1 aunque solo haya una |
| `brand` | Cada startup | Unidad de aislamiento del día a día |
| `brand_profile` | Posicionamiento, tono, ICP, pilares, léxico prohibido, ofertas | **Versionado.** Cada pieza registra con qué versión se generó |
| `channel_account` | Cuenta conectada por canal | Guarda referencia a Secret Manager y fecha de expiración, no el token |
| `approval_policy` | `(marca, canal) → auto \| manual \| asistido` | Tres columnas que implementan todo el requisito de control mixto |
| `strategy` | Objetivos, mensajes clave, mix de canales, por trimestre | Insumo estable de las grillas mensuales |
| `content_plan` | La grilla de un mes | Estados: `borrador → aprobada → en_ejecución → cerrada` |
| `plan_slot` | Publicación planificada: fecha, canal, formato, pilar, ángulo, brief | El corazón de la grilla |
| `content_piece` | La ejecución: copy real + referencias a assets | Separada del slot a propósito |
| `content_revision` | Cada versión, con `author = 'ia' \| 'humano'` | La señal de calidad más honesta del sistema |
| `asset` | Imagen/video en GCS + cómo se produjo | Reutilizable entre piezas |
| `publication` | Intento de publicar: agendada, publicada, ID externo, permalink | Separada de la pieza para poder reintentar |
| `metric_snapshot` | Métricas de una publicación en un instante | Serie de tiempo, no una fila que se sobrescribe |
| `pipeline_run` / `pipeline_step` | Ejecuciones y pasos, con entrada/salida, intentos y errores | La única forma real de depurar |
| `ai_call` | Modelo, tokens, costo, latencia, tarea, hash de prompt, versión de perfil | Sin esto no se sabe dónde se va el presupuesto |

### Tres decisiones defendidas

**`plan_slot` ≠ `content_piece`.** El slot es la *intención* ("el 12 de agosto, LinkedIn, pilar educación financiera, ángulo mito común"); la pieza es la *ejecución*. Separarlos permite aprobar la grilla antes de que exista una línea de texto, regenerar una pieza sin perder la planificación, y ver el calendario completo aunque el 80% no esté generado.

**`plan_slot.source_slot_id`.** Una columna nullable que apunta a otro slot. Modela el reciclaje sin inventar estructuras: el artículo del blog es el slot padre; el post de LinkedIn y el carrusel de Instagram son derivados que heredan su contexto.

**`content_revision` con autor.** Cada edición humana sobre una pieza generada queda registrada. Cuánto se edita es una métrica de calidad disponible desde el primer día, mucho antes de que el engagement diga algo estadísticamente útil. En la Fase 4 esas ediciones se convierten en ejemplos que alimentan al generador.

---

## 5. Pipeline

### Los seis flujos

| Flujo | Disparador | Produce |
|---|---|---|
| **P1 · Estrategia** | Trimestral o manual | Objetivos, mensajes clave, mix de canales |
| **P2 · Grilla mensual** | Cron mensual (día 20 del mes anterior) | `content_plan` en borrador con sus `plan_slot` |
| **P3 · Producción** | Cron diario, ~5 días antes de cada slot | `content_piece` + assets |
| **P4 · Publicación** | Cron cada 15 min | `publication` con ID externo y permalink |
| **P5 · Métricas** | Cron diario | `metric_snapshot` por publicación viva |
| **P6 · Aprendizaje** | Mensual, **antes** de P2 | Informe que alimenta la grilla siguiente |

P6 corre antes de P2: ese es el ciclo cerrado. La grilla de septiembre nace leyendo qué pasó en agosto.

### Pasos por flujo

**P1 · Estrategia**
1. `cargar_contexto` — perfil de marca + histórico de desempeño
2. `investigar` *(nodo agéntico, Fase 5)* — tendencias del sector, competencia
3. `generar_estrategia` — LLM de razonamiento, salida validada por esquema
4. Revisión humana → `aprobada`

**P2 · Grilla mensual**
1. `cargar_contexto` — estrategia + perfil + informe de P6 + fechas relevantes
2. `idear_angulos` *(nodo agéntico, Fase 5)*
3. `proponer_grilla` — LLM de razonamiento → N slots
4. `validar_grilla` — determinístico: cadencia por canal, distribución de pilares, sin choques de fecha, capacidad respetada
5. `expandir_derivados` — determinístico: crea slots hijos vía `source_slot_id`
6. → `borrador`, notificación, revisión humana → `aprobada`

**P3 · Producción**
1. `construir_brief` — ensambla contexto de marca + slot + ejemplos de piezas bien evaluadas
2. `generar_copy` — LLM de redacción, salida estructurada por canal
3. `generar_assets` — plantilla o Vertex según formato
4. `qa_de_marca` — reglas determinísticas + LLM utilitario
5. `decidir_ruta` — consulta `approval_policy`

**P4 · Publicación** — `seleccionar_agendadas` → `publicar` (idempotente) → `registrar_resultado`

**P5 · Métricas** — `recolectar` por canal → `normalizar` → `snapshot`

**P6 · Aprendizaje** — agregar métricas + tasa de edición humana → `analizar` *(nodo agéntico, Fase 5)* → informe

### Máquina de estados de una pieza

```
plan_slot: planificado
     │  construir_brief
     ▼
generando ──────────► fallida ──► (reintento con backoff)
     │  generar_copy + generar_assets
     ▼
   en_qa
     ├── puntaje bajo ──────────────► en_revisión
     ├── política = manual ──────────► en_revisión ──► aprobada
     ├── política = asistido ────────► notificación al usuario
     └── política = auto + QA ok ────► aprobada
                                          ▼
                                      agendada ──► publicada ──► métricas
```

### La compuerta de QA

Incluso en un canal configurado como automático, **un puntaje bajo de QA fuerza revisión humana**. Ese detalle es lo que hace defendible la publicación autónoma.

El QA tiene dos capas:
- **Reglas determinísticas:** largo por canal, cantidad de hashtags, léxico prohibido, disclaimers obligatorios, presencia de alt text. Baratas y no fallan.
- **LLM utilitario:** evalúa tono, coherencia con el pilar y afirmaciones riesgosas, devolviendo puntaje con justificación. Cubre lo que las reglas no pueden expresar.

### Invariantes de ingeniería

1. **Cada paso es idempotente.** Reejecutarlo produce el mismo resultado.
2. **Publicar usa clave de idempotencia** (`publication.id` viaja al conector). Un reintento tras un timeout nunca produce un post duplicado.
3. **Aislamiento por pieza.** Si falla el slot #14, los otros 29 siguen.
4. **Un solo lugar define las transiciones válidas.** Ningún paso muta el estado de otro.
5. **Cortacircuitos por canal.** Tres fallos seguidos pausan el canal y notifican.

### Nodos agénticos

Solo tres (`investigar`, `idear_angulos`, `analizar`), todos de **solo lectura**, sin permiso de escribir estado ni publicar, cada uno con presupuesto máximo de pasos y tokens. Si se agota, devuelven lo que tengan y el pipeline determinístico continúa. **Un agente nunca es un punto de falla del flujo.**

---

## 6. Capa de IA

### Interfaz única

```ts
ejecutarTarea(nombreTarea, contexto, esquema) → { datos, costo, trazas }
```

### Registro de tareas

| Tarea | Nivel de modelo | Frecuencia |
|---|---|---|
| `generar_estrategia` | Razonamiento | 4×/año/marca |
| `proponer_grilla` | Razonamiento | 12×/año/marca |
| `analizar_desempeño` | Razonamiento | 12×/año/marca |
| `generar_copy` | Redacción | cientos/mes |
| `adaptar_a_canal` | Redacción | cientos/mes |
| `qa_de_marca` | Utilitario | cientos/mes |
| `generar_alt_text` | Utilitario | cientos/mes |
| `extraer_hashtags` | Utilitario | cientos/mes |

Ese es el argumento a favor de OpenRouter: lo que corre 12 veces al año usa el modelo caro; lo que corre cientos de veces al mes usa el barato. El registro declara por tarea el **nivel** (no un modelo específico), su fallback, temperatura, presupuesto de tokens y esquema de salida. Los modelos concretos de cada nivel se fijan en la Fase 0 y se cambian mediante evals.

### Salidas estructuradas

Ninguna tarea devuelve texto libre. Cada una declara un esquema Zod que se envía como `json_schema` y se valida al recibir. Si falla la validación: **un** reintento incluyendo el error en el prompt; si vuelve a fallar, el paso se marca fallido. **Nunca hay parsing de texto con expresiones regulares.**

### Ensamblaje de prompts

```
1. Instrucciones de la tarea  → versionadas en el repo (git)
2. Perfil de marca            → desde la BD (versión fijada)
3. Reglas del canal           → largo, formato, tono, límites
4. Ejemplos                   → piezas aprobadas y bien evaluadas
5. Brief del slot             → el encargo concreto
```

Las instrucciones viven en el repo (revisables, con historial); el perfil de marca vive en la BD (editable sin desplegar). Los ejemplos de la capa 4 salen de `content_revision`: las piezas aprobadas sin editar son los mejores ejemplos posibles y son gratis.

### Reproducibilidad y costos

Cada `ai_call` guarda modelo exacto, hash del prompt, versión del perfil de marca, tokens y costo. Presupuesto mensual configurable **por marca**: al 80% avisa; al 100% pausa las tareas no críticas y todo pasa a cola manual en lugar de fallar en silencio.

### Evaluaciones

Un set de ~10 casos dorados por marca (brief conocido → salida esperada). Se corren antes de cambiar cualquier modelo o prompt. Dado que el catálogo de OpenRouter cambia constantemente, esta es la única forma de cambiar de modelo sin apostar a ciegas sobre el contenido público de las empresas.

### Imágenes

Fuera de OpenRouter, por dos caminos complementarios:

- **Plantillas de marca** (carruseles, placas, citas): render de HTML/CSS a imagen con Satori + resvg dentro del worker. Determinista, sin costo, consistente. Cubre la mayoría del volumen.
- **Imágenes generadas:** modelos de imagen de **Vertex AI**, llamados directo. Misma autenticación de GCP, sin salto de proveedor.

---

## 7. Publicación

### Realidad de cada canal

> Estos detalles deben verificarse al implementar: las plataformas cambian sus políticas con frecuencia.

| Canal | Dificultad | Obstáculo |
|---|---|---|
| **Blog propio** | Trivial | Ninguno |
| **Facebook Page** | Moderada | Token de página + revisión de app de Meta |
| **Instagram** | Alta | Cuenta Profesional, publicación en 2 pasos, medios en URL pública, límite ~50/24h, revisión de app |
| **LinkedIn (empresa)** | Muy alta | Requiere postulación al programa de partners de LinkedIn. Publicar como persona es mucho más fácil |
| **TikTok** | Muy alta | Sin auditoría aprobada, solo publicación como borrador privado |

Blog y Facebook pueden estar operativos en días; Instagram en semanas; LinkedIn empresarial y TikTok pueden tomar meses o no llegar.

### Estrategia: doble camino

`core/publish` expone una interfaz única, lo que permite soportar ambos caminos sin costo adicional:

- **Agregador** (Ayrshare, Blotato, Postiz o similar) para arrancar en días, a cambio de costo mensual y dependencia.
- **Apps propias** tramitadas en paralelo, migrando canal por canal a medida que se aprueban. Es el único camino viable si esto se vuelve producto.

La decisión concreta se toma al inicio de la Fase 3, según el estado de los trámites en ese momento. El diseño no depende de ella.

### Red de seguridad: modo asistido

Todo canal soporta `asistido`: el sistema genera la pieza, deja el asset listo y envía una notificación con copy e imagen para publicar manualmente. Es el modo de arranque de cualquier canal no aprobado, el respaldo automático cuando un token expira, y la cobertura de formatos que las APIs no soportan bien. Sin esa válvula, un rechazo de Meta congela el proyecto completo.

### Interfaz de conector

```ts
interface ConectorDeCanal {
  publicar(pieza, cuenta, claveIdempotencia) → { idExterno, permalink }
  obtenerMetricas(idExterno, cuenta)         → MetricasNormalizadas
  validar(pieza)                             → Problema[]
  verificarPublicacion(claveIdempotencia)    → Publicacion | null
  refrescarToken(cuenta)                     → Credenciales
}
```

`validar()` corre **antes** de generar, no después: informa al generador de los límites del canal (largo, hashtags, duración mínima de video). Descubrirlos al publicar significa haber pagado tokens por una pieza inválida.

### El conector de blog

Las tres marcas tienen sitios propios en **Next.js o HTML estático** — no hay CMS de terceros, así que no se requiere conector de WordPress ni equivalente. El artículo se guarda en `content_piece` como cualquier otra pieza; lo que cambia es cómo llega al sitio. Dos modos tras la misma interfaz:

- **`blog_api`** (sitios Next.js): el sistema expone los artículos publicados de una marca en un endpoint autenticado y de solo lectura. El sitio los consume con ISR. Publicar = marcar el artículo como publicado y llamar al webhook de revalidación del sitio. Es el modo preferido: publicar y despublicar son instantáneos y no requieren build.
- **`blog_estatico`** (sitios HTML): el sistema genera el archivo del artículo y lo entrega al repositorio del sitio mediante un commit, lo que dispara su despliegue. Más lento y con más partes móviles; se usa solo donde el primer modo no aplique.

El modo se configura por marca en `channel_account`. Este es el único canal donde `publicar()` no habla con una API de terceros, y por eso es el primero en implementarse: permite ejercitar el pipeline completo de punta a punta sin depender de ninguna aprobación externa.

### Renovación de tokens

Cron diario que renueva credenciales antes de expirar (los tokens de Meta y LinkedIn duran del orden de 60 días) y alerta ante fallos. Combinado con el cortacircuitos: un canal que empieza a fallar se pausa, cae a modo asistido y notifica. **Los tokens expirados son la causa número uno de que estos sistemas mueran en silencio.**

---

## 8. Métricas

Esquema normalizado: `alcance, visualizaciones, interacciones, clics, guardados, compartidos, comentarios, Δseguidores`. Cada campo **acepta `null`**.

**Dos trampas evitadas por diseño:**

1. **No todas las plataformas dan lo mismo.** LinkedIn no entrega analítica de posts personales por API; Meta ha ido deprecando y renombrando métricas. Regla: `null` significa "no disponible", nunca `0`, y ningún reporte compara un campo entre plataformas como si midiera lo mismo.

2. **Comparar posts de distinta edad.** Los snapshots se capturan a **1 h, 24 h, 7 d y 30 d** desde la publicación, y todo análisis usa la ventana equivalente. Sin esto, el agente de aprendizaje concluiría sistemáticamente que el contenido viejo funciona mejor.

Las métricas del blog salen de GA4 vía la Google Analytics Data API, dentro del mismo entorno de Google Cloud.

---

## 9. Manejo de errores

| Tipo | Ejemplos | Tratamiento |
|---|---|---|
| **Transitoria** | Red caída, 429, 5xx | Backoff exponencial + jitter, hasta 5 reintentos |
| **Permanente** | Esquema inválido, token revocado, pieza que viola reglas | No se reintenta. Se escala a la bandeja |
| **Ambigua** | Timeout al publicar | `verificarPublicacion()` antes de decidir |

El caso ambiguo es el peligroso: reintentar a ciegas produce contenido duplicado en las cuentas reales.

### Degradación en cascada

- Canal falla → modo **asistido**
- QA con puntaje bajo → **revisión manual**
- Presupuesto de IA agotado → **manual**, no error
- Nodo agéntico agota presupuesto → devuelve lo que tenga, el pipeline sigue

### Alertas

Token por expirar, cortacircuitos activado, presupuesto al 80%, grilla sin aprobar a 5 días del inicio de mes — y, la más importante, un **latido diario**: si en 48 horas no hubo publicaciones ni ejecuciones de pipeline, avisa. Estos sistemas fallan callados; el silencio no es éxito.

---

## 10. Pruebas

- **Unitario:** reglas de QA, validadores por canal, tabla de transiciones. Funciones puras, sin red.
- **Contrato:** cada conector contra respuestas reales grabadas de cada plataforma.
- **Idempotencia:** cada paso se ejecuta dos veces en el test y se afirma el mismo resultado. Explícito.
- **Marcha en seco:** bandera `PUBLICAR_EN_SECO` que corre el pipeline completo contra un canal falso que escribe a la BD. Permite probar un mes entero sin tocar una red social. **Se construye en la Fase 0.**
- **Evals de IA:** casos dorados por marca antes de cambiar modelo o prompt.

No se prueba que el LLM escriba bien — eso no es testeable con aserciones. Se prueba el *contrato*: que la salida valide contra el esquema, respete los límites del canal y no contenga léxico prohibido. La calidad la juzgan los evals y la tasa de edición humana.

---

## 11. Plan de fases

| Fase | Qué se construye | Entregable |
|---|---|---|
| **0 · Fundaciones** | Repo, Cloud SQL + esquema, `core/ai` con registro de tareas y log de costos, canal falso, marcha en seco, CI | `ejecutarTarea()` corriendo y registrando cada peso gastado |
| **1 · Marca y estrategia** | Perfiles de las 3 marcas, P1 + P2, UI de calendario, aprobación de grilla | Grilla mensual aprobable para las 3 marcas |
| **2 · Fábrica de contenido** | P3, QA de dos capas, plantillas de imagen, bandeja de aprobación, editor, modo asistido | Piezas listas para publicar manualmente en segundos |
| **3 · Publicación** | Blog → Facebook → Instagram. Decisión agregador vs. apps propias. Cortacircuitos, renovación de tokens | Publicación automática por canal habilitado |
| **4 · Métricas y aprendizaje** | P5, P6, reportes, ciclo cerrado | La grilla del mes siguiente nace de los datos del anterior |
| **5 · Refinamiento** | Nodos agénticos, imágenes por IA en Vertex, LinkedIn empresarial, TikTok | Autonomía y calidad |
| **6 · Video** | Guion → voz → clips → render → subtítulos | Reels y TikTok reales |

**Dos observaciones sobre el orden:**

Las Fases 1 y 2 entregan valor **sin depender de ninguna aprobación de API**. Al terminar la Fase 2 hay estrategia, grilla y piezas listas para las tres marcas, publicando a mano — la mayor parte del trabajo que hoy consume tiempo. Si Meta se demora tres meses, el sistema igual está produciendo.

Los trámites empiezan el **día 1**, no en la Fase 3. Crear las apps de Meta y TikTok y postular al programa de LinkedIn es papeleo que corre en paralelo al desarrollo. Es el camino más largo del proyecto y no depende de escribir código.

---

## 12. Supuestos y decisiones diferidas

| Punto | Supuesto por defecto | Cuándo se resuelve |
|---|---|---|
| Modelos concretos por nivel | Se fijan en la Fase 0 mediante evals; el registro de tareas declara niveles, no modelos | Fase 0 |
| Agregador vs. apps propias | Arquitectura dual desde el diseño; arranque con blog propio + modo asistido | Inicio de Fase 3 |
| Notificaciones del modo asistido | Correo electrónico en la Fase 2; un bot de mensajería puede sumarse después sin cambios de diseño | Fase 2 |
| Cadencia de publicación por canal | Configurable por marca; los valores iniciales se definen con la estrategia de cada marca | Fase 1 |

---

## 13. Siguiente paso

Plan de implementación detallado para las **Fases 0 y 1**. Los bloques posteriores obtendrán su propio spec derivado de este documento.
