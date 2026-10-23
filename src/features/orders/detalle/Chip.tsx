import type { ReactNode } from 'react'

export type ChipTone = 'green' | 'amber' | 'blue' | 'violet' | 'red' | 'gray' | 'orange'

/** Etiqueta de estado de la edición de pedidos (paleta del brief; ver pos-edicion-pedido.css). */
export function Chip({ tone, children, title }: { tone: ChipTone; children: ReactNode; title?: string }) {
  return <span className={`ped-chip ped-chip-${tone}`} title={title}>{children}</span>
}
