# El worker fuera de la máquina local (bloque 1C-B)

**Fecha:** 2026-08-06
**Estado:** diseño aprobado, pendiente de plan
**Rama:** `feat/worker-en-la-nube`

## Por qué existe este bloque

Después de 1C-A y 1C-A2 la app vive en Vercel y la base en Cloud SQL. **El worker sigue en el escritorio del dueño**, dentro de `docker compose`, sondeando `pipeline_runs` cada dos segundos. Mientras esa máquina esté apagada —o Docker no esté corriendo, o el `.env` no tenga la clave— nadie genera nada: la web encola la corrida, la pantalla dice «encolada», y ahí se queda.

Es el último punto del sistema que exige que una persona tenga algo prendido a mano. Sacarlo es lo que termina de cumplir lo que 1C empezó.

## La decisión que reencuadra el bloque

`pendientes.md` registraba 1C-B con **dos** mitades: mover el worker, y que Cloud Scheduler encendiera y apagara la instancia de Cloud SQL sola. La segunda **se descarta**, y conviene dejar escrito el porqué, porque no era obvio al anotarla:

**Una instancia apagada no solo detiene al worker: deja la app web muerta.** Cada página lee la base en cada petición, así que con la instancia apagada `marketing-ai-web.vercel.app` responde 500 a todo, y volver a encenderla toma del orden de un par de minutos. Un horario de encendido significa, literalmente, que la app no existe fuera de ese horario — que es lo contrario de lo que 1C-A vino a construir.

Y lo que se ahorra es menor de lo que la anotación sugería: apagar detiene el cobro de CPU y memoria, pero **el disco se factura igual**. Sobre una `db-f1-micro`, apagar doce horas al día ahorra del orden de la mitad de la parte de cómputo — unos pocos dólares al mes.

**Sustituto:** una **alerta de presupuesto** en Google Cloud, que sí entra en este bloque. Avisa cuando el gasto se sale de lo esperado, que es el problema real —una factura que crece sin que nadie mire— sin apagar nada.

## Lo que NO cambia

Vale decirlo primero, porque es casi todo:

- El motor (`@gc/pipeline`), los flujos P1 y P2, el esquema, las siete migraciones.
- `tomarCorridaPendiente`, con su `FOR UPDATE SKIP LOCKED`.
- **`tomarYEjecutarUna` y `registrarFallo`**, que es donde vive todo lo probado del worker.
- La web entera: pantallas, Server Actions, autenticación, la guarda de sesión de `ejecutar`.
- El CLI.
- El desarrollo local con Docker.

La decisión que tomó 1B —*«el bucle es deliberadamente trivial: todo lo que vale la pena probar vive en `tomarYEjecutarUna`»*, comentada en `apps/worker/src/main.ts`— es lo que hace este bloque chico. Lo único que se tira es el bucle.

## Arquitectura

```
Usuario aprieta «Generar»  ─────────────►  Vercel (Server Action)
                                             │  encolar(): pipeline_runs = 'pendiente'   [Cloud SQL]
                                             │  despertar(): crea una tarea (~100 ms)    [Cloud Tasks]
                                             └─ devuelve; la pantalla dice «encolada»

Cloud Tasks ──POST /trabajar + token OIDC──►  Cloud Run: servicio `worker`
                                                · escala a cero, máximo 1 instancia
                                                · drena la cola hasta que no quede nada
                                                · responde 200 y la instancia se apaga sola

Cloud Scheduler, cada 5 min ──POST /trabajar──►  (red de seguridad)
```

### Por qué Cloud Tasks y no una llamada directa

**No es una preferencia: las dos plataformas lo fuerzan.**

Una Server Action de Vercel no puede «avisar y seguir»: si no espera la respuesta, la función termina y la petición en vuelo se corta. Y del otro lado, **Cloud Run —con su facturación por petición, que es la de omisión— le quita CPU a la instancia en cuanto responde**, así que el worker tampoco puede contestar `202` y ponerse a trabajar después. (Existe la facturación por instancia, que deja la CPU asignada siempre; se descarta porque cobra el tiempo ocioso, que es justo lo que escalar a cero viene a evitar.) Esperar los minutos que tarda generar rompe la regla no negociable de que la capa web nunca ejecuta trabajo largo, además del límite de duración de una función de Vercel.

Cloud Tasks corta el nudo: la web crea una tarea en unos cien milisegundos y se va; Cloud Tasks llama a Cloud Run, espera los minutos que haga falta y reintenta si la llamada falla. Es exactamente lo que el [diseño general](2026-07-31-gestor-contenido-multimarca-design.md) dibujó el 2026-07-31.

### Servicio, no trabajo (job)

Cloud Run ofrece las dos formas. Se elige **servicio** porque tiene URL propia y se invoca por HTTP autenticado, que es lo que Cloud Tasks y Cloud Scheduler saben hacer. Un *job* solo arranca por la API de administración, lo que obligaría a la web a hablar con esa API en vez de con una URL.

## El worker: de bucle a servidor

`apps/worker/src/main.ts` pierde el `while` y el `setTimeout`, y gana un servidor de `node:http` —sin framework; es un endpoint— con una ruta: `POST /trabajar`.

El handler llama a una función nueva, **`drenarCola`**, que invoca `tomarYEjecutarUna` en bucle hasta que devuelve `nada` y acumula el recuento. Responde `200` con `{ completadas, fallidas }`. `drenarCola` vive aparte del handler para que se pueda probar sin levantar un servidor.

Toda otra ruta o método responde `404`.

### Autorización: la pone Google, y el código pone un cerrojo más

El servicio se despliega `--no-allow-unauthenticated`, así que **Cloud Run rechaza toda petición sin token IAM antes de que llegue al proceso**. Esa es la barrera real, y significa que el worker no necesita lógica de sesión de ninguna clase.

Encima de eso, el handler exige un **token compartido en una cabecera**, comparado con `timingSafeEqual`. Diez líneas cuyo único propósito es que un `--allow-unauthenticated` puesto por error —o heredado de una prueba— no deje el endpoint abierto a internet. Este proyecto falla cerrado; esto es lo que cuesta que siga haciéndolo.

Si la variable del token no está definida, el worker **no arranca**. Misma política que ya tiene con `OPENROUTER_API_KEY`: prefiere no levantar antes que levantar sin protección.

### El sondeo sobrevive, pero solo en local

En local no hay Cloud Tasks ni Cloud Scheduler. El contenedor de `docker compose` conserva el bucle de sondeo, encendido por una variable **`SONDEO_MS`** que en Cloud Run no se declara. Con la variable ausente el worker solo escucha HTTP.

Es el mismo patrón que ya usa `destinoDeConexion`: en local no se toca nunca el camino de la nube, y eso está aceptado y documentado. La contrapartida honesta: **el camino de despertar por Cloud Tasks solo se ejercita en la nube**, y por eso la verificación manual de §«Cómo se verifica» no es opcional.

## El despertador

Un paquete nuevo y chico: **`@gc/despertador`**, con dos piezas:

1. Una **función pura** que lee el entorno y decide, con la misma forma que `destinoDeConexion`, `usaAgrupador` y `correoPermitido`: las cinco variables presentes → despierta; las cinco ausentes → no hace nada (el caso local); **algunas sí y otras no → error explícito**, nunca una caída silenciosa al camino equivocado.
2. La llamada a Cloud Tasks, que crea una tarea HTTP apuntando a `POST /trabajar` con un token OIDC.

### Se llama después de `encolar`, nunca adentro

Si crear la tarea falla, **la corrida ya está a salvo en la base y la red de seguridad la levanta en cinco minutos**. Por eso el despertar es mejor esfuerzo: registra el fallo en el log y no rompe el encolado. Meterlo dentro de `encolar` invertiría eso —un fallo de Google haría fallar una escritura que ya había funcionado.

### Por qué paquete propio

`@gc/operaciones` es hoy dominio y base puros, y está dentro del cierre de dependencias de `apps/web`. Meterle el SDK de Google Cloud Tasks lo convierte en otra cosa. Un paquete de una responsabilidad, con su función pura probada, mantiene el límite.

Consecuencia operativa: **`docker-compose.yml` necesita su volumen**, y `pnpm comprobar:volumenes` —que corre en CI— lo va a exigir. Eso es la comprobación haciendo su trabajo, no un obstáculo.

### Variables nuevas, solo en Vercel

Cinco, en el ámbito Production únicamente, igual que las nueve de 1C-A: proyecto, región, nombre de la cola, URL del servicio de Cloud Run, y la cuenta de servicio con la que Cloud Tasks firma el token OIDC.

El CLI usa la misma función. En local no tiene esas variables —apunta a Docker— así que no despierta a nadie y el sondeo local lo cubre.

## Credenciales: un secreto menos, no uno más

En Cloud Run la cuenta de servicio va **adherida al servicio**: las credenciales están disponibles en el entorno sin que nadie copie un JSON a ninguna parte.

Eso pide un cambio acotado en `destinoDeConexion` (`packages/db/src/destino.ts`): **`GOOGLE_CREDENCIALES_JSON` pasa a ser opcional**. Si falta, `crearConexion` construye el `GoogleAuth` sin credenciales explícitas y toma las del entorno; si está, se comporta exactamente como hoy, que es lo que Vercel necesita porque allá no hay identidad de Google adherida.

Es una mejora de seguridad, no solo una comodidad: `pendientes.md` ya registra que esa clave estuvo cargada en un proyecto desechable de Vercel y **no se rotó**. Este camino evita agregarle una copia más.

`OPENROUTER_API_KEY` va en **Secret Manager**, montada como variable de entorno del servicio. Es la única credencial del worker que cuesta dinero si se filtra.

**La cuenta de servicio del worker necesita `roles/cloudsql.client`** —la misma que ya tiene la de Vercel— para que el conector autorice contra la instancia.

## Concurrencia: una sola instancia, y el latido sigue siendo deuda

`pendientes.md` advierte que la aproximación de los quince minutos para decidir si una corrida está abandonada «deja de alcanzar en cuanto haya varias instancias, **que es lo que trae llevar el worker a la nube**».

**Se resuelve no trayéndolas: `max-instances=1`.** Con eso el sistema queda exactamente tan concurrente como hoy —un worker secuencial— y la columna de arriendo (`lease_until`) sigue siendo deuda registrada en vez de trabajo de este bloque. Con del orden de diez generaciones al mes no hay problema de rendimiento que justifique construirla ahora.

Si dos tareas llegan a la vez, Cloud Run encola la segunda o la rechaza, y Cloud Tasks reintenta con espera creciente. El resultado visible es el mismo que hoy: las generaciones se atienden de a una.

**Dos consecuencias honestas:**

- El falso positivo del panel —«nadie tomó esta generación» cuando en realidad el worker está ocupado con otra— **sigue existiendo igual**. Este bloque no lo mejora ni lo empeora.
- El aviso de los treinta segundos **sobrevive sin tocarse** para el caso normal: el arranque en frío de un contenedor de Node más la construcción del conector miden segundos, bien por debajo del umbral. Es una estimación, y la verificación manual la confirma o la desmiente.

## Despliegue automático, sin claves nuevas

GitHub Actions construye la imagen, la empuja a Artifact Registry y despliega con `gcloud run deploy --image`.

**La imagen se construye en Actions y no en Cloud Build.** El repositorio es público, así que esos minutos son gratis, y evita depender de un servicio más.

La autenticación es por **federación de identidad de carga de trabajo**: GitHub presenta su token OIDC y Google se lo cambia por credenciales efímeras. **Ninguna clave de cuenta de servicio guardada en los secretos de GitHub** — que sería exactamente lo contrario de lo que argumenta la sección anterior.

**El despliegue es un trabajo más dentro del workflow de CI que ya existe**, con `needs: test` y condicionado a `master`. Así la dependencia queda expresada donde se lee —desplegar una imagen que no pasó las pruebas sería peor que no desplegar— en vez de encadenar dos workflows por `workflow_run`, que es más maquinaria para la misma garantía.

Sin filtro de rutas: **todo push a `master` que pase las pruebas despliega**. Un despliegue redundante cuesta un par de minutos de Actions y nada más, y evita la pregunta de si un cambio en `packages/shared` afecta o no al worker — la respuesta es que sí, y una lista de rutas mantenida a mano es una forma conocida de equivocarse en eso.

### Un Dockerfile de producción, aparte del de desarrollo

El `apps/worker/Dockerfile` actual monta el código como volumen y lo corre con `tsx` — dice en su primera línea que es una imagen de desarrollo, y lo es. La de producción **copia** el workspace, instala con `--frozen-lockfile` y corre el mismo `tsx`. Los dos archivos conviven; el de desarrollo no se toca.

## Costo

| | |
|---|---|
| Cloud Run | ~10 generaciones/mes de minutos, más ~8.640 despertadas de la red de seguridad de unos segundos cada una |
| Cloud Tasks | ~10 operaciones al mes |
| Cloud Scheduler | 1 trabajo |
| Artifact Registry | una imagen de Node, del orden de centavos al mes |
| GitHub Actions | gratis en repositorio público |

Las tres primeras caen holgadamente dentro de las capas gratuitas que Google publica para cada servicio. **Esas cifras salen de la documentación de Google y no de una factura propia**, así que el plan tiene que confirmarlas en la calculadora al crear cada recurso — el mismo cuidado que 1C-A2 tuvo con el costo de Cloud SQL, donde la estimación inicial resultó baja.

La factura real sigue siendo la instancia de Cloud SQL, igual que hoy.

## Manejo de errores

- **Una corrida que falla** no cambia de comportamiento: `tomarYEjecutarUna` no lanza, `registrarFallo` la marca, y `drenarCola` sigue con la siguiente. El endpoint responde `200` con `fallidas > 0`, porque la petición se atendió bien; devolver `500` haría que Cloud Tasks reintentara una generación que ya falló por su cuenta y volvería a cobrar el modelo.
- **Un fallo de infraestructura** —la base caída al tomar— sí lanza, y ahí el handler responde `500`. Cloud Tasks reintenta con espera creciente, que es exactamente lo que quieres cuando la base vuelve.
- **Una tarea perdida** —Cloud Tasks agotó sus reintentos, o la creación de la tarea falló— la levanta la red de seguridad en cinco minutos.
- **Una corrida encolada por el CLI local contra la base remota** no crea tarea, y también la levanta la red de seguridad.
- **`SIGTERM`**: Cloud Run avisa antes de apagar una instancia ociosa. El manejador actual del worker se conserva; con el trabajo dentro de la petición, una instancia con trabajo en curso no se apaga.

## Los dos límites de tiempo que hay que fijar a conciencia

Generar tarda minutos, así que los valores por omisión no sirven:

- **El tiempo de espera del servicio de Cloud Run**, que por omisión es corto y hay que subir.
- **El plazo de despacho de la tarea de Cloud Tasks**, que tiene que ser al menos tan largo como el anterior; si vence antes, Cloud Tasks da la tarea por fallida y la reintenta mientras la primera sigue corriendo — dos workers en la misma cola.

Según la documentación de Google, el tiempo de espera de un servicio de Cloud Run llega a 60 minutos y el plazo de despacho de una tarea HTTP de Cloud Tasks a 30. **Esas dos cifras no están comprobadas por este proyecto** y el plan las tiene que verificar antes de fijarlas — cambian con el tiempo y equivocarse produce el modo de falla de arriba. Los valores propuestos son **30 minutos para el plazo de Cloud Tasks y 20 para el tiempo de espera de Cloud Run**, con amplio margen sobre los minutos que tarda una generación.

Lo que este diseño exige, y no es negociable aunque las cifras cambien, es la **relación**: plazo de Cloud Tasks ≥ tiempo de espera de Cloud Run ≥ lo que tarda la generación más lenta con sus reintentos.

## Cómo se verifica

**En la máquina, sin credenciales de Google:**

- Las 464 pruebas siguen verdes, más `pnpm -r typecheck`, `pnpm comprobar:aislamiento` y `pnpm comprobar:volumenes`.
- La función pura del despertador: cinco presentes, cinco ausentes, y los casos parciales que tienen que dar error.
- **`drenarCola` contra Postgres de verdad:** N corridas pendientes → N procesadas y el recuento correcto; cola vacía → devuelve de inmediato sin tomar nada; una corrida que falla no detiene a las siguientes.
- **El handler HTTP** contra un puerto efímero: ruta y método correctos, `404` para lo demás, y **rechazo sin el token compartido** — con la mutación de rigor, que es quitar la comprobación y ver la prueba roja.
- **`destinoDeConexion` sin `GOOGLE_CREDENCIALES_JSON`** devuelve el destino de Cloud SQL en vez de fallar.
- El worker local sigue funcionando por `docker compose` con `SONDEO_MS`.

**Solo con las credenciales del dueño, y conducido por Claude con él ingresando lo que sea credencial:**

- Desplegar de verdad y ver el servicio arriba.
- **Apretar «Generar» en la app desplegada, con Docker apagado en la máquina del dueño, y ver la grilla aparecer.** Esta es la prueba que importa y ninguna de las de arriba la reemplaza: es la única que ejercita Cloud Tasks, el token OIDC, el conector desde Cloud Run y el drenado, todos juntos.
- Medir cuánto tarda desde el clic hasta que la corrida pasa a `en_curso`, y confirmar —o desmentir— que queda bajo los treinta segundos del aviso.
- Encolar desde el CLI y comprobar que la red de seguridad la levanta.
- Configurar la alerta de presupuesto.

## Riesgos

**Que la imagen de producción no arranque en Cloud Run aunque el contenedor local funcione.** Es un monorepo de pnpm con `tsx` y sin compilar; la imagen de desarrollo monta el código y la de producción lo copia, que no es lo mismo. Se mitiga construyendo y corriendo la imagen de producción **en local** antes de tocar Cloud Run.

**Que el conector empaquetado se comporte distinto.** `pendientes.md` ya registra que el bundle de la web no está probado en ese punto; el worker no pasa por webpack, así que corre el conector tal cual — el mismo camino que sí funcionó en la prueba de humo de 1C-A2. Es un riesgo menor que el de la web, y no lo hereda.

**Que los límites de tiempo queden mal calibrados** y produzcan dos workers sobre la misma cola. Cubierto por la relación que fija la sección de límites, y por `FOR UPDATE SKIP LOCKED`, que impide que dos se lleven la misma corrida aunque ambos estén vivos.

**Que la federación de identidad quede mal configurada** y el despliegue automático falle en silencio. Se mitiga exigiendo que el primer despliegue por Actions se vea llegar a Cloud Run, no solo que el workflow salga verde.

## Fuera de alcance, a propósito

- **Encender y apagar la instancia de Cloud SQL sola.** Descartado con motivo escrito, arriba. Se sustituye por la alerta de presupuesto.
- **La columna de latido o arriendo.** Innecesaria mientras haya una sola instancia; sigue registrada en `pendientes.md`.
- **Reanudar de verdad desde el CLI.** Deuda aparte, del insumo 1 de Prioridad 1.
- **Mover el CLI a la nube.** Es una herramienta de operación, corre donde esté quien la usa.
- **Publicar en redes.** Es la Fase 3 y no existe todavía.
