import { useEffect, useState } from 'react'
import { CircleDollarSign } from 'lucide-react'
import { consultarSaldo, type SaldoCliente } from '../infrastructure/hermes/client'
import { featureFlags } from '../config/featureFlags'

const money = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Ficha de cliente / cotización / carrito: saldo a favor real desde Hermes. Resuelto
 * server-side (api/hermes/consultar-saldo.ts) — este componente solo llama a ese
 * endpoint propio, nunca a Hermes directo. Tres estados posibles: sin cuenta en
 * Hermes (badge ámbar), al día o puente caído (sin badge), o deudor/acreedor (badge
 * rojo/verde). Nunca un error ni un estado de carga que bloquee la pantalla.
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

  if (!saldo) return null // puente caído: no inventar nada
  if (saldo.sinCuenta) {
    return (
      <small className="saldo-badge saldo-badge-sin-cuenta">
        <CircleDollarSign /> Sin cuenta en Hermes
      </small>
    )
  }
  // Convención de Hermes (v_saldo_cliente): saldo_confirmado > 0 = DEUDOR,
  // < 0 = ACREEDOR (saldo a favor), 0 = AL_DIA. El signo NO es intuitivo —
  // es un libro auxiliar de cuentas por cobrar, no una billetera.
  if (saldo.saldoConfirmado === 0) return null // al día: no hay nada que decir
  const debe = saldo.saldoConfirmado > 0
  return (
    <small className={`saldo-badge ${debe ? 'saldo-badge-deudor' : 'saldo-badge-acreedor'}`}>
      <CircleDollarSign /> {debe ? 'Debe' : 'Saldo a favor'}: Bs {money(Math.abs(saldo.saldoConfirmado))}
    </small>
  )
}
