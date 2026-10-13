/** La misma solicitud recupera su recibo; cambios de efectivo recibido o referencia son otra intención. */
export function cobroVtdFingerprint(input: {
  actorId: string
  sesionCajaId: string
  ventaIds: string[]
  pagos: Array<{ method: string; amountCents: number; receivedCents?: number; referencia?: string }>
}): string {
  return JSON.stringify([
    input.actorId,
    input.sesionCajaId,
    [...new Set(input.ventaIds)].sort(),
    input.pagos.map((p) => [p.method, p.amountCents, p.receivedCents ?? null, p.referencia || null]),
  ])
}
