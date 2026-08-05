import type { ReactNode } from 'react'
import './globals.css'

/**
 * Layout raíz de verdad: envuelve **todo**, incluida `/entrar` — que el
 * middleware excluye a propósito porque tiene que ser alcanzable sin sesión
 * (ver `middleware.ts`). Por eso no puede tocar la base ni pintar nada que
 * dependa de una organización: antes este archivo hacía `conexion()` y
 * `marcasDeLaOrganizacion(...)` para armar el selector de marcas, y como no
 * hay forma de que un layout se salte de una ruta que envuelve, `/entrar`
 * heredaba esa consulta también. Dos consecuencias: `GET /entrar` sin cookie
 * exponía el nombre de las tres marcas de la organización a quien fuera, y en
 * un despliegue nuevo sin ninguna organización todavía, `resolverOrganizacion`
 * fallaba con `permanente(...)` y la pantalla de entrada respondía 500 — nadie
 * podía entrar a crear la primera organización porque la pantalla para
 * entrar dependía de que ya existiera una.
 *
 * El encabezado con el selector de marca se movió al layout del grupo de
 * rutas `(app)` (`app/(app)/layout.tsx`), que cubre `/` y `/[marca]/...` pero
 * no `/entrar`. Este layout queda con lo mínimo: el documento HTML y los
 * estilos globales.
 */
export default function RaizLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  )
}
