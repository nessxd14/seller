import type { CashSessionRecord, CustomerRecord, OrderView, QuoteDraft } from '../../application/shared/models'

export const customerSeeds: CustomerRecord[] = [
  { id: 'c1', name: 'Librería San Marcos', type: 'wholesale', document: '1029384012', phone: '76543210', email: 'compras@sanmarcos.bo', address: 'Av. Arce 1280, La Paz', usualChannel: 'mayoreo', paymentTerms: 'Crédito 15 días', creditLimitCents: 1500000, pendingBalanceCents: 245000 },
  { id: 'c2', name: 'Colegio Nueva Esperanza', type: 'institutional', document: '2048573018', phone: '72004122', email: 'administracion@nuevaesperanza.edu.bo', address: 'C. 12 de Calacoto #44', usualChannel: 'institucional', paymentTerms: '50% anticipo · saldo contra entrega', creditLimitCents: 3000000, pendingBalanceCents: 0 },
  { id: 'c3', name: 'Papelería El Estudiante', type: 'wholesale', document: '3451209011', phone: '71238590', email: 'pedidos@elestudiante.bo', address: 'Av. Buenos Aires 440', usualChannel: 'mayoreo', paymentTerms: 'Contado', creditLimitCents: 500000, pendingBalanceCents: 78500 },
]

export const quoteSeeds: QuoteDraft[] = [
  { id: 'q1', number: 'COT-2026-0042', customerId: 'c2', customerName: 'Colegio Nueva Esperanza', channel: 'institucional', status: 'approved', validUntil: '2026-08-10', terms: 'Entrega en 7 días · 50% anticipo', notes: 'Campaña escolar segundo semestre', generalDiscountCents: 0, createdAt: '2026-07-22T14:30:00Z', lines: [{ id: 'ql1', productId: '1', name: 'Cuaderno TUKI 50 hojas', sku: 'CUA-TUK-050', quantity: 120, unitPriceCents: 1580, discountBasisPoints: 0 }] },
  { id: 'q2', number: 'COT-2026-0041', customerId: 'c1', customerName: 'Librería San Marcos', channel: 'mayoreo', status: 'sent', validUntil: '2026-08-05', terms: 'Crédito 15 días', notes: '', generalDiscountCents: 5000, createdAt: '2026-07-21T10:00:00Z', lines: [{ id: 'ql2', productId: '4', name: 'Resma Bond Carta', sku: 'RES-BON-C75', quantity: 20, unitPriceCents: 5350, discountBasisPoints: 500 }] },
]

export const orderSeeds: OrderView[] = [
  { id: 'o1', number: 'PED-2026-0187', customerName: 'Librería San Marcos', channel: 'mayoreo', status: 'preparing', createdAt: '2026-07-22T15:00:00Z', lines: [{ id: 'ol1', productId: '4', name: 'Resma Bond Carta', sku: 'RES-BON-C75', quantity: 30, unitPriceCents: 5350, discountBasisPoints: 0, prepared: 20, allocations: [{ location: 'Almacén', quantity: 20 }, { location: 'Tienda', quantity: 10 }] }], events: [{ at: '22 jul · 15:00', label: 'Pedido confirmado', detail: 'Creado por Natalia S.' }, { at: '22 jul · 15:15', label: 'Stock reservado', detail: '20 Almacén · 10 Tienda' }, { at: '23 jul · 08:10', label: 'Preparación iniciada', detail: '20 de 30 unidades listas' }] },
]

export const cashSeeds: CashSessionRecord[] = []

