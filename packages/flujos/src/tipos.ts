import type { ClienteLlm } from '@gc/ai'

/** Dependencias inyectadas a los flujos P1, P2 y P3. */
export interface Dependencias {
  cliente: ClienteLlm
  env?: Record<string, string | undefined>
}
