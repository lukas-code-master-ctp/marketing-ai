import type { ClienteLlm } from '@gc/ai'

/** Dependencias inyectadas a los flujos P1 y P2. */
export interface Dependencias {
  cliente: ClienteLlm
  env?: Record<string, string | undefined>
}
