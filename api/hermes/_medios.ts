// Valores de hermes.medio_pago (schema.fixture.json), idénticos a public.metodo_pago, que es
// lo que el POS manda en `medio` (pendiente.metodo). Si Hermes agrega un medio, se suma acá.
export const MEDIOS_PAGO_HERMES: ReadonlySet<string> = new Set(['EFECTIVO', 'QR', 'DEPOSITO', 'TRANSFERENCIA', 'SIGEP', 'CHEQUE'])
