import { NIVELES, type Nivel } from '@gc/db'

/**
 * El nivel vive en `@gc/db` y no acá porque la columna `level` de
 * `model_catalog` lo hace cumplir con un `CHECK`, y `@gc/db` no puede
 * importar `@gc/ai`: está en el cierre de dependencias de `apps/web`, así
 * que esa flecha pondría roja la comprobación de aislamiento.
 */
export type NivelDeModelo = Nivel
export { NIVELES }
