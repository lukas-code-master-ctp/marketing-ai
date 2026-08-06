import { config } from 'dotenv'
import type { NextConfig } from 'next'
import { fileURLToPath } from 'node:url'

// Next.js busca su propio .env en apps/web. El del proyecto vive en la raíz,
// y tener dos sería volver a un problema que este repositorio ya resolvió.
config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) })

const nextConfig: NextConfig = {
  // Los paquetes del workspace se distribuyen como TypeScript sin compilar.
  // La lista incluye los transitivos y no solo los que la app importa directo:
  // @gc/operaciones arrastra @gc/brand.
  //
  // Ojo con lo que esta lista NO hace: no es lo que permite compilar el
  // TypeScript del workspace, ni impide resolver lo que se omite. Next sigue
  // los symlinks de pnpm hasta la ruta real de cada paquete, que cae fuera de
  // node_modules, y por eso ya los trata como código de primera parte. Se
  // comprobó quitando @gc/brand y @gc/strategy de aquí: el build siguió
  // pasando. La lista se mantiene explícita porque documenta el conjunto de
  // paquetes que la web transpila y no depende de ese detalle de resolución.
  //
  // Que @gc/ai, @gc/pipeline y @gc/flujos no aparezcan no es lo que los deja
  // fuera: eso lo garantiza el grafo de dependencias, y se verifica con la
  // comprobación de `require.resolve` documentada en CLAUDE.md.
  transpilePackages: [
    '@gc/brand', '@gc/db', '@gc/operaciones', '@gc/shared', '@gc/strategy',
  ],
  // `@google-cloud/tasks` (y su dependencia `google-gax`) generan, al
  // evaluar el módulo, un `require(path.join(dirname(import.meta.url), ...))`
  // para cargar JSON de configuración (`cloud_tasks_client_config.json`,
  // `protos/protos.json`, `package.json`) — una ruta que webpack no puede
  // analizar en build y reemplaza por un contexto vacío que lanza
  // "Cannot find module" en cuanto se evalúa. Comprobado empaquetando el
  // `await import('@google-cloud/tasks')` de
  // `packages/despertador/src/despertar.ts` sin ningún tratamiento especial:
  // `apps/web/.next/server/chunks/587.js` (2.2 MB) contenía el
  // `CloudTasksClient` real, con esos tres `require(path.join(...))` intactos
  // apuntando al contexto vacío (módulo webpack 47131, la forma minificada de
  // `webpackEmptyContext`). El import dinámico evita que ese código se evalúe
  // al *cargar* `acciones.ts`, pero no evita que webpack lo empaquete: en
  // producción, con las seis variables del despertador presentes, ese import
  // sí se alcanza y el mismo `require` roto habría fallado siempre —
  // atrapado por el `try/catch` de `despertarWorker`, así que sin romper la
  // Server Action, pero sin despertar nunca al worker tampoco.
  //
  // `serverExternalPackages` es el mecanismo que Next ofrece para esto —y el
  // que se probó primero, porque además resolvería la misma clase de
  // problema para el conector de Cloud SQL (deuda que dejó registrada
  // docs/superpowers/specs/pendientes.md)— pero **no tuvo ningún efecto**:
  // declarando ahí `@google-cloud/tasks`, `google-gax`,
  // `@google-cloud/cloud-sql-connector`, `google-auth-library`, `gaxios` y
  // `@googleapis/sqladmin`, y confirmando con `required-server-files.json`
  // que Next había recibido la lista, el chunk generado seguía teniendo el
  // mismo `CloudTasksClient` completo y el mismo `require(path.join(...))`
  // roto — sin ningún cambio de tamaño ni de contenido. Se verificó también
  // que ni siquiera `pg` (que la documentación de Next dice externalizar por
  // omisión) queda fuera del bundle en esta app: ninguno de los seis
  // paquetes, ni `pg`, aparece como `require("paquete")` literal en ningún
  // archivo de `apps/web/.next/server`. La causa exacta no se investigó más
  // allá de esto —podría ser la interacción con `transpilePackages` o con
  // cómo Next seguía los symlinks de pnpm de los paquetes del workspace—,
  // pero el resultado es inequívoco: en este build, `serverExternalPackages`
  // no excluye nada del bundle del servidor. Se sacó de aquí porque dejarlo
  // declarado sin efecto habría afirmado, en un comentario, algo que la
  // build no hace.
  //
  // La salida que sí funciona es el comentario mágico `webpackIgnore` en el
  // import dinámico (`packages/despertador/src/despertar.ts`): con él,
  // webpack deja el `import("@google-cloud/tasks")` intacto en el chunk de
  // las Server Actions en vez de convertirlo en una carga de chunk — el
  // chunk de 2.2 MB desapareció del build y ninguna cadena de
  // `@google-cloud/tasks` (`cloudtasks.googleapis.com`, `CloudTasksClient`)
  // quedó en ningún otro archivo de `.next/server`.
  //
  // La contrapartida que el propio comentario mágico advierte: un import que
  // webpack ignora tampoco lo traza para el sistema de archivos que Vercel
  // sube junto a la función — se comprobó que `page.js.nft.json` no listaba
  // ni un solo archivo de `@google-cloud/tasks` ni de `google-gax` con solo
  // `webpackIgnore`, así que el import fallaría en producción de todos
  // modos, con "Cannot find module" en vez del contexto vacío, pero igual de
  // roto. `outputFileTracingIncludes` es lo que cierra ese hueco: fuerza a
  // Next a incluir esas rutas en el rastreo de cada página sin que webpack
  // las toque. Con esta declaración, `page.js.nft.json` sí lista los
  // archivos de `@google-cloud/tasks` y de `google-gax` (confirmado
  // buscando `.pnpm/@google-cloud+tasks` y `.pnpm/google-gax` dentro de la
  // lista). No se agregaron aquí los cuatro paquetes del conector de Cloud
  // SQL: ese conector se importa de forma **estática**, no dinámica —
  // `webpackIgnore` solo aplica a la expresión de import que lo lleva al
  // lado, y forzar el mismo tratamiento ahí exigiría convertir también esa
  // importación a dinámica, que es un cambio de otro alcance. La entrada de
  // deuda sobre el conector sigue abierta en `pendientes.md`, con esta
  // comprobación agregada; no queda resuelta acá.
  outputFileTracingIncludes: {
    '/**': [
      '../../node_modules/.pnpm/@google-cloud+tasks@*/node_modules/@google-cloud/tasks/**/*',
      '../../node_modules/.pnpm/google-gax@*/node_modules/google-gax/**/*',
    ],
  },
  // Todo el código del proyecto importa con extensión .js apuntando a
  // archivos .ts (estilo ESM/NodeNext). Vitest lo resuelve solo; el webpack
  // de Next necesita este alias explícito o falla con "Module not found".
  experimental: {
    extensionAlias: {
      '.js': ['.ts', '.tsx', '.js'],
    },
  },
}

export default nextConfig
