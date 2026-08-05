# La base en Cloud SQL en vez de Neon (bloque 1C-A2)

**Fecha:** 2026-08-05
**Estado:** diseño aprobado, pendiente de plan
**Rama:** `feat/despliegue-y-autenticacion` — se adapta *antes* de fusionar

## Por qué existe este bloque

El bloque 1C-A dejó la rama lista para desplegar en **Neon + Vercel**. La
decisión cambió: el dueño del proyecto administra el backend y las bases de
datos de todos sus proyectos en **Google Cloud**, y quiere que este no sea la
excepción. Vercel se mantiene, porque ya paga el plan y el despliegue desde git
es lo que hace fácil el ciclo.

Se adapta sobre la misma rama y no después de fusionar. Si se fusiona primero,
`main` queda documentando un despliegue en Neon que ya se descartó, y habría que
deshacerlo en un segundo viaje. Es el mismo trabajo hecho una vez.

## Lo que NO cambia

Conviene decirlo primero porque es la mayor parte de la rama:

- La autenticación con Google, la lista de correos permitidos, la revalidación
  en cada lectura, el middleware y la configuración partida edge/servidor.
- La guarda de sesión dentro del ayudante `ejecutar`, por el que pasan las nueve
  Server Actions.
- La tabla `users` y las tres columnas de autoría.
- Las siete migraciones y el esquema entero.
- El desarrollo local: Docker con `gestor` y `gestor_test`, exactamente igual.
- Vercel como destino de la app.

Nada de eso sabe ni le importa dónde vive el Postgres.

## La decisión de fondo: el conector, no la lista de redes

Una función de Vercel no tiene dirección IP estable. Para que alcance a Cloud
SQL hay tres caminos, y se elige el tercero:

**Descartado — abrir la base a `0.0.0.0/0` con SSL.** Es lo más rápido y
conserva el driver actual. Se descarta porque la base guarda la estrategia de
contenido de tres empresas, y una lista de redes que acepta a todo internet deja
la contraseña como única barrera. El ahorro de trabajo no paga eso.

**Descartado — las Static IPs de Vercel.** Están disponibles en el plan Pro que
ya se paga, pero cuestan USD 100 al mes por proyecto más el tráfico por GB. Es
mucho dinero recurrente para resolver algo que el conector resuelve gratis.

**Elegido — el conector de Node de Cloud SQL.** Es una librería, no un binario
local, así que corre dentro de una función serverless. Establece la conexión con
certificados efímeros y **reemplaza la autorización por firewall con IAM**: la
lista de redes autorizadas queda vacía y aun así Vercel entra, porque lo que
autoriza es la cuenta de servicio, no la dirección de origen.

Su costo es que **soporta `pg` (node-postgres), no `postgres-js`**, que es el
driver que este proyecto usa hoy. Para drivers no soportados existe
`startLocalProxy()`, que levanta un proxy local por socket Unix — y eso sí es
inviable en Vercel. O sea que el conector obliga al cambio de driver; no es una
preferencia.

### El supuesto que hay que despejar antes que nada

La documentación del conector describe el mecanismo (librería pura, TLS contra
la IP pública, sin binario) y solo menciona el conector de VPC como requisito
para IP **privada**, que no es el caso. Pero **no afirma explícitamente que
funcione en Vercel**. Todo este diseño descansa en ese supuesto.

Por eso el primer paso del plan es una prueba de humo desplegable: una ruta
mínima en Vercel que abra una conexión por el conector y devuelva
`SELECT 1`. Si eso falla, el diseño cambia —habría que volver a evaluar las
Static IPs contra la lista de redes abierta— y es mucho más barato descubrirlo
antes de tocar el driver que después.

## El cambio de driver, y por qué la onda expansiva es chica

`packages/db/src/cliente.ts` pasa de `drizzle-orm/postgres-js` a
`drizzle-orm/node-postgres`. Drizzle soporta los dos de primera mano.

Lo que hace que esto sea contenido y no una refactorización mayor: el paquete ya
exporta el alias `BaseDeDatos`, y **los 36 archivos de diez paquetes que lo usan
solo ven el alias**. Cambiar a qué apunta —de `PostgresJsDatabase` a
`NodePgDatabase`— es una línea, y ninguno de los 36 se entera. La abstracción ya
estaba puesta.

Los llamadores reales de `crearConexion` son cuatro: `apps/cli/src/main.ts`,
`apps/web/src/datos.ts`, `apps/worker/src/main.ts` y el arnés de pruebas
`packages/db/src/pruebas/entorno.ts`.

**El riesgo real no es el tipo, es la semántica.** Dos drivers distintos pueden
devolver lo mismo de formas distintas: cómo llega un `jsonb`, si un `numeric`
viene como número o como cadena, cómo se materializa un `timestamptz`. Las 450
pruebas corren contra Postgres de verdad y por eso son la red que atrapa esto —
pero **la conversión no se da por buena porque el typecheck pase**: se da por
buena porque la suite sigue verde, y cualquier prueba que haya que ajustar para
que pase es un hallazgo que hay que explicar, no un trámite.

## Cómo decide `crearConexion` qué camino tomar

Hoy la firma es `crearConexion(url: string)`. Con el conector no se conecta por
URL: se conecta por nombre de instancia más usuario, contraseña y base.

La solución es que `crearConexion` tenga dos caminos y que **la decisión de cuál
usar sea una función pura y probada**, siguiendo la forma que este proyecto ya
usa en `usaAgrupador` y en `correoPermitido`:

- Si está definida `CLOUD_SQL_INSTANCIA` —el nombre de conexión de la
  instancia, con la forma `proyecto:región:instancia`— se conecta por el
  conector, tomando usuario, contraseña y base de sus propias variables.
- Si no, se conecta por URL con `DATABASE_URL`, como siempre.

Eso deja el desarrollo local, el CLI, el worker y las pruebas exactamente igual
que hoy: apuntan a Docker por `DATABASE_URL` y no tocan el conector nunca. Y
deja el camino de Vercel expresado sin condicionales repartidos por el código.

**Cerrado por omisión no aplica aquí**, pero sí su pariente: la función tiene
que ser inequívoca. Si el nombre de instancia está presente pero incompleto, el
error tiene que decirlo, no caer silenciosamente al camino de URL y fallar más
adelante con un mensaje sobre `localhost`.

### Autenticación: contraseña por el conector, no IAM database auth

El conector soporta las dos. Se elige **contraseña**, porque IAM database
authentication obliga a que el usuario de la base sea un principal de IAM, y eso
complica el camino del CLI y del worker corriendo en una máquina local sin
credenciales de Google.

Lo que importa —que no haya una lista de redes abierta— ya lo da el conector con
cualquiera de las dos. IAM database auth queda anotado en `pendientes.md` como
endurecimiento posterior, no como deuda.

## Dos piezas que quedan sin sentido

**`packages/db/src/agrupador.ts`** detecta el sufijo `-pooler` en la primera
etiqueta del anfitrión, que es la convención de Neon. Cloud SQL no la tiene, así
que la función devolvería `false` siempre. Y con `node-postgres` la opción que
gobernaba —`prepare: false`— ni siquiera es la misma: el manejo de sentencias
preparadas es distinto entre los dos drivers.

**Decisión: se elimina**, con sus pruebas y su exportación. Código que no se
ejecuta nunca y que describe una infraestructura que no se usa es peor que no
tenerlo: la próxima persona lo lee y concluye cosas falsas sobre el despliegue.

**`DATABASE_URL_DIRECTA` en `drizzle.config.ts`** separa las dos cadenas de
Neon. Cloud SQL no tiene esa división. **Decisión: se elimina** de
`drizzle.config.ts` y de `.env.example`, y su lugar lo toma lo que sí necesita
el nuevo camino de migraciones.

Las dos eliminaciones arrastran documentación en `CLAUDE.md`, que hoy tiene una
regla no negociable dedicada al agrupador.

## Las migraciones

Es el punto operativo que hay que resolver bien, porque drizzle-kit corre fuera
de la app y no puede usar el conector de la misma forma.

El camino es el **Cloud SQL Auth Proxy** ejecutado localmente: levanta un
escucha en `localhost` que tuneliza hacia la instancia autenticando por IAM, y
drizzle-kit se conecta a ese `localhost` con una cadena normal. No hace falta
abrir nada ni cambiar `drizzle.config.ts` más allá de quitar la variable de
Neon.

El plan tiene que dejar el procedimiento escrito paso a paso en `CLAUDE.md`,
porque es la operación que se hace pocas veces y siempre bajo presión.

## Lo que queda explícitamente fuera

- **El worker no se mueve a Google todavía.** Sigue corriendo local y contra la
  base remota cuando haga falta generar. Moverlo es el bloque **1C-B**, y en
  Google la salida es mejor que la que había pensada para Neon: Cloud Scheduler
  despertando un trabajo, en vez del sondeo cada dos segundos. Pero es un bloque
  con su propio spec, no un apéndice de este.
- **Cloud Run.** La app se queda en Vercel. Evaluado y descartado en la
  conversación previa: el despliegue desde git ya funciona y ya está pagado.
- **IP privada y conector de VPC.** IP pública con el conector alcanza para tres
  personas y evita montar red.
- **Managed Connection Pooling.** Exige edición Enterprise Plus. Con tres
  personas el agotamiento de conexiones no es un problema real; lo que sí hay
  que hacer es mantener el `max` del pool bajo, porque cada invocación de Vercel
  abre el suyo.

## Costo

Cloud SQL **no tiene plan gratuito** y no se apaga sola: la instancia corre y se
factura las 24 horas. La más chica está en el orden de USD 10 a 25 al mes.

Es el precio de la decisión, y es deliberado: se paga por tener la base donde
está todo el resto del backend, en la misma factura. Neon habría sido gratis.

Las cifras hay que confirmarlas en la calculadora de Google al crear la
instancia; las de aquí son de referencia.

## Cómo se verifica

El reparto es el mismo de siempre en este proyecto, y la parte honesta es
reconocer qué no se puede verificar sin las credenciales del dueño.

**Se verifica en la máquina, sin crear ninguna cuenta:**

- Las 450 pruebas siguen verdes con el driver nuevo, contra Postgres de verdad.
  Es la comprobación central: si la conversión de tipos cambió, aquí se ve.
- `pnpm -r typecheck`, `pnpm --filter @gc/web build`, y los dos guardianes.
- La función pura que elige el camino de conexión, con sus casos borde.
- El uso real en el navegador con la sesión de desarrollo, como se hizo al
  cerrar 1C-A.

**Solo se puede verificar con la cuenta de Google, y por eso es una lista para
el dueño, no una tarea de agente:**

- La prueba de humo del conector en Vercel. **Va primera**, antes del cambio de
  driver, porque es la que puede invalidar el diseño.
- Aplicar las siete migraciones por el Auth Proxy.
- Entrar con Google contra la base en Cloud SQL, aprobar una grilla, y
  comprobar en SQL que `approved_by` quedó con el id correcto.
- Que una cuenta fuera de la lista siga siendo rechazada con el mensaje legible.

## Riesgos

**El supuesto del conector en serverless.** Ya tratado: se despeja primero y con
una prueba desechable.

**La semántica del driver nuevo.** Cubierto por las 450 pruebas, con la
advertencia de que ajustar una prueba para que pase es un hallazgo y no un
trámite.

**El pool por invocación.** Vercel abre un proceso por invocación y cada uno su
pool. Con tres personas no es un problema, pero el `max` tiene que quedar bajo y
documentado, porque el modo de falla —agotar las conexiones de la instancia— no
aparece nunca en local.

**La factura que corre sola.** Cloud SQL no se apaga. Es la diferencia de
operación más grande respecto de lo que la rama documenta hoy, y `CLAUDE.md`
tiene que decirlo donde alguien lo lea.
