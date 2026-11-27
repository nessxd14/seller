import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { PantallaCobro } from '../../domain/pantalla/pantallaCliente'

/** Cobro en curso: lo publica PaymentModal con los valores que ya calcula (sin duplicar la matemática). */
export interface CobroEnCurso { cobro: PantallaCobro; total: number }
/** Venta recién cobrada: congela ticket, total y cobro, porque el carrito se limpia al cerrar el modal. */
export interface GraciasEnCurso { id: number; ticket?: string; total: number; cobro?: PantallaCobro }

interface PantallaClienteApi {
  cobroEnCurso: CobroEnCurso | null
  gracias: GraciasEnCurso | null
  /** `total` = dinero nuevo que paga el cliente ahora (puede diferir del total del carrito: saldo, pedido, VTD). */
  setCobro: (cobro: PantallaCobro | null, total?: number) => void
  anunciarGracias: (datos: Omit<GraciasEnCurso, 'id'>) => void
  limpiarGracias: () => void
}

const SIN_PROVEEDOR: PantallaClienteApi = {
  cobroEnCurso: null,
  gracias: null,
  setCobro: () => undefined,
  anunciarGracias: () => undefined,
  limpiarGracias: () => undefined,
}

const PantallaClienteContext = createContext<PantallaClienteApi>(SIN_PROVEEDOR)

export function PantallaClienteProvider({ children }: { children: ReactNode }) {
  const [cobroEnCurso, setCobroEnCurso] = useState<CobroEnCurso | null>(null)
  const [gracias, setGracias] = useState<GraciasEnCurso | null>(null)
  const setCobro = useCallback((cobro: PantallaCobro | null, total?: number) => {
    setCobroEnCurso(cobro ? { cobro, total: total ?? 0 } : null)
  }, [])
  const anunciarGracias = useCallback((datos: Omit<GraciasEnCurso, 'id'>) => {
    setCobroEnCurso(null)
    setGracias({ ...datos, id: Date.now() })
  }, [])
  const limpiarGracias = useCallback(() => setGracias(null), [])
  const value = useMemo(() => ({ cobroEnCurso, gracias, setCobro, anunciarGracias, limpiarGracias }), [cobroEnCurso, gracias, setCobro, anunciarGracias, limpiarGracias])
  return <PantallaClienteContext.Provider value={value}>{children}</PantallaClienteContext.Provider>
}

/** Sin proveedor (tests, otras pantallas) todo es no-op: el POS no depende de la pantalla del cliente. */
export const usePantallaCliente = () => useContext(PantallaClienteContext)
