import { useEffect, useState } from 'react'
import { CircleDollarSign } from 'lucide-react'
import { consultarSaldo, type SaldoCliente } from '../infrastructure/hermes/client'
import { featureFlags } from '../config/featureFlags'

const money = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Ficha de cliente / cotización / carrito: saldo a favor real desde Hermes. Resuelto
 * server-side (api/hermes/consultar-saldo.ts) — este componente solo llama a ese
 * endpoint propio, nunca a Hermes directo. Si no hay saldo, el cliente no está
 * importado a Hermes, o la consulta falla por cualquier razón: no se muestra nada,
 * nunca un error ni un estado de carga que bloquee la pantalla.
 */
export function SaldoBadge({ clienteId }: { clienteId?: string }) {
  const [saldo, setSaldo] = useState<SaldoCliente | null>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the previous customer's badge immediately when clienteId changes, before the new fetch resolves
    setSaldo(null)
    if (!featureFlags.supabase || !clienteId) return
    const id = Number(clienteId)
    if (!Number.isFinite(id) || id <= 0) return
    let cancelled = false
    void consultarSaldo(id).then((result) => { if (!cancelled) setSaldo(result) })
    return () => { cancelled = true }
  }, [clienteId])

  if (!saldo || saldo.saldoConfirmado <= 0) return null
  return (
    <small className="saldo-badge">
      <CircleDollarSign /> Saldo a favor: Bs {money(saldo.saldoConfirmado)}
    </small>
  )
}
