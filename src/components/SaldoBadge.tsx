import { useEffect, useState } from 'react'
import { CircleDollarSign } from 'lucide-react'
import { consultarSaldo, type ResultadoSaldo } from '../infrastructure/hermes/client'
import { featureFlags } from '../config/featureFlags'

const money = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Ficha de cliente / cotización / carrito: saldo a favor real desde Hermes. Resuelto
 * server-side (api/hermes/consultar-saldo.ts) — este componente solo llama a ese
 * endpoint propio, nunca a Hermes directo.
 *
 * Cuatro estados visuales (Brief S4) + el transitorio de "todavía no se consultó"
 * (sin badge, como antes de esta consulta):
 *   - no-disponible: gris "Saldo no disponible" — un puente caído NUNCA se ve igual
 *     que un cliente al día, a diferencia de antes.
 *   - sin-cuenta: ámbar "Sin cuenta en Hermes".
 *   - confirmado y provisional iguales, ≠ 0: rojo/verde "Debe"/"Saldo a favor".
 *   - confirmado ≠ provisional: rojo con nota "· Bs X en revisión" — el caso del
 *     cliente que ya pagó y su pago sigue PROPUESTO sin confirmar en Hermes. La regla
 *     que importa: si saldoProvisional es 0, nunca decir "Debe", aunque el confirmado
 *     no lo sea.
 *   - ambos 0: sin badge (al día, no hay nada que decir).
 */
export function SaldoBadge({ clienteId }: { clienteId?: string }) {
  const [saldo, setSaldo] = useState<ResultadoSaldo | null>(null)

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

  if (!saldo) return null // todavía no se consultó: transitorio, no inventar nada
  if (saldo.estado === 'no-disponible') {
    return (
      <small className="saldo-badge saldo-badge-no-disponible">
        <CircleDollarSign /> Saldo no disponible
      </small>
    )
  }
  if (saldo.estado === 'sin-cuenta') {
    return (
      <small className="saldo-badge saldo-badge-sin-cuenta">
        <CircleDollarSign /> Sin cuenta en Hermes
      </small>
    )
  }
  // Convención de Hermes (v_saldo_cliente): saldo_confirmado > 0 = DEUDOR,
  // < 0 = ACREEDOR (saldo a favor), 0 = AL_DIA. El signo NO es intuitivo —
  // es un libro auxiliar de cuentas por cobrar, no una billetera.
  const { saldoConfirmado, saldoProvisional } = saldo
  if (saldoConfirmado === 0 && saldoProvisional === 0) return null // al día: no hay nada que decir
  const enRevisionBs = Math.abs(saldoConfirmado - saldoProvisional)
  // Si lo provisional es 0, el pago ya viajó a Hermes y solo falta que Rony lo confirme
  // — mostrar "Debe" acá es exactamente el bug del brief: reclamarle al cliente plata
  // que ya pagó. Nota neutra, sin "Debe" ni "Saldo a favor", mientras se resuelve.
  if (saldoProvisional === 0) {
    return (
      <small className="saldo-badge saldo-badge-en-revision">
        <CircleDollarSign /> Bs {money(enRevisionBs)} en revisión
      </small>
    )
  }
  const debe = saldoProvisional > 0
  const enRevision = saldoConfirmado !== saldoProvisional
  return (
    <small className={`saldo-badge ${debe ? 'saldo-badge-deudor' : 'saldo-badge-acreedor'}`}>
      <CircleDollarSign /> {debe ? 'Debe' : 'Saldo a favor'}: Bs {money(Math.abs(saldoProvisional))}
      {enRevision && <> · Bs {money(enRevisionBs)} en revisión</>}
    </small>
  )
}
