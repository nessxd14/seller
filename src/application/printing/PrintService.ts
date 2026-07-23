export type PrintFormat = 'ticket-58' | 'ticket-80' | 'quote-a4' | 'order-a4' | 'delivery-a4'
export const printLabels: Record<PrintFormat, string> = { 'ticket-58': 'Ticket térmico 58 mm', 'ticket-80': 'Ticket térmico 80 mm', 'quote-a4': 'Cotización A4', 'order-a4': 'Pedido A4', 'delivery-a4': 'Nota de entrega A4' }
export const printDocument = () => window.print()

