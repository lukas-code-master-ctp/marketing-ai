import { handlers } from '../../../../auth.js'

// Maneja el callback de OAuth y la sesión: depende de la petición (cookies,
// parámetros de la URL) en cada llamada, así que no puede prerenderizarse.
export const dynamic = 'force-dynamic'

export const { GET, POST } = handlers
