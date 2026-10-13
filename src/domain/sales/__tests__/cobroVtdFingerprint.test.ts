import { describe, expect, it } from 'vitest'
import { cobroVtdFingerprint } from '../cobroVtdFingerprint'

const base = { actorId: 'cajero', sesionCajaId: '1', ventaIds: ['2','1'], pagos: [{ method: 'cash', amountCents: 3000, receivedCents: 5000 }] }

describe('Reintentos de cobro VTD', () => {
  it('recupera el mismo recibo si solo cambia el orden o se repite una VTD', () => {
    expect(cobroVtdFingerprint({ ...base, ventaIds: ['1','2','1'] })).toBe(cobroVtdFingerprint(base))
  })
  it('distingue efectivo recibido, referencia, cajero y turno', () => {
    for (const changed of [
      { ...base, pagos: [{ ...base.pagos[0], receivedCents: 6000 }] },
      { ...base, pagos: [{ ...base.pagos[0], referencia: 'recibo' }] },
      { ...base, actorId: 'otro-cajero' },
      { ...base, sesionCajaId: '2' },
    ]) expect(cobroVtdFingerprint(changed)).not.toBe(cobroVtdFingerprint(base))
  })
  it('conserva el orden de reparto de un pago mixto', () => {
    const pagos = [{ method: 'cash', amountCents: 1000 }, { method: 'qr', amountCents: 2000 }]
    expect(cobroVtdFingerprint({ ...base, pagos })).not.toBe(cobroVtdFingerprint({ ...base, pagos: [...pagos].reverse() }))
  })
})
