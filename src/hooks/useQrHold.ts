import { useEffect, useRef, useState } from 'react'
import { turnoService } from '../infrastructure/services'

// Brief Caja-2 B1: pasado este umbral sin VERIFICADO, se le ofrece al cajero seguir
// esperando o dejar la venta retenida (QR pendiente en "Mis tickets").
export const QR_HOLD_TIMEOUT_S = 90
export const QR_HOLD_POLL_MS = 3000

/**
 * Retención de una venta con pago QR mientras el banco está en línea: espera VERIFICADO con un
 * poll cada 3 s a venta_pago.estado_verificacion y, a los 90 s, ofrece seguir esperando o dejar
 * la venta retenida. Con el banco fuera de línea no retiene nunca: un scraper caído no puede
 * frenar al cajero. Compartido por el cobro de mostrador (PaymentModal) y el de pedidos de vendedor.
 */
export function useQrHold({ saleId, saleIds, onVerified }: { saleId: string | null; saleIds?: string[]; onVerified: () => void }) {
  const [phase, setPhase] = useState<'esperando' | 'vencida' | null>(null)
  const [elapsedS, setElapsedS] = useState(0)
  const [qrAmountCents, setQrAmountCents] = useState(0)
  const [bankOfflineNotice, setBankOfflineNotice] = useState(false)
  const onVerifiedRef = useRef(onVerified)
  useEffect(() => { onVerifiedRef.current = onVerified }, [onVerified])
  const idsKey = JSON.stringify(saleIds ?? (saleId ? [saleId] : []))

  useEffect(() => {
    const ids = JSON.parse(idsKey) as string[]
    if (phase !== 'esperando' || !ids.length) return
    const startedAt = Date.now()
    const interval = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000)
      setElapsedS(elapsed)
      if (elapsed >= QR_HOLD_TIMEOUT_S) { setPhase('vencida'); return }
      void Promise.all(ids.map(id => turnoService.estadoPagoQr(id)))
        .then((estados) => { if (estados.every(estado => estado === 'VERIFICADO' || estado === 'NO_APLICA')) { setPhase(null); onVerifiedRef.current() } })
        .catch(() => { /* red caída — se sigue esperando, el próximo tick reintenta */ })
    }, QR_HOLD_POLL_MS)
    return () => window.clearInterval(interval)
  }, [phase, idsKey])

  return {
    phase, elapsedS, qrAmountCents, bankOfflineNotice,
    /** true si la venta quedó retenida esperando al banco; false si no hay retención (banco offline o caído). */
    async iniciar(montoQrCents: number): Promise<boolean> {
      setQrAmountCents(montoQrCents)
      try {
        const estado = await turnoService.estadoBancoQr()
        if (estado.enLinea) { setElapsedS(0); setPhase('esperando'); return true }
      } catch { /* sin estado del banco: se trata como offline */ }
      setBankOfflineNotice(true)
      return false
    },
    seguirEsperando() { setElapsedS(0); setPhase('esperando') },
  }
}
