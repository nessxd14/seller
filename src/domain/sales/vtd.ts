// Brief VTD — helpers puros, sin dependencia de Supabase, para no reimplementar reglas que
// ya vive en el backend (brief 2.6: "la UI no debe reimplementar la regla, solo manejar bien
// el error").

/** Código Postgres de `insufficient_privilege` (usado por app_puede_revertir_venta vía
 * `raise ... using errcode = 'insufficient_privilege'`). PostgREST lo expone en error.code. */
export const INSUFFICIENT_PRIVILEGE_CODE = '42501'

export const esErrorAutorizacion = (error: unknown): boolean =>
  Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === INSUFFICIENT_PRIVILEGE_CODE)

/** abrir_venta rechaza clientes institución/corporativo/mayorista con este mensaje —
 * ver brief 2.2. Se detecta por texto (no hay un código propio) para ofrecer el camino
 * de pedido con cotización en vez de mostrar el error crudo. */
export const esErrorSoloRetail = (error: unknown): boolean =>
  error instanceof Error && error.message.toLowerCase().includes('solo para retail')

/** ajustar_venta_abierta rechaza dejar la venta en cero con este mensaje (brief 2.5: "la UI
 * debe detectar ese caso ANTES de llamar y ofrecer directamente el botón de anular"). Se usa
 * client-side antes del submit (ver VentaDirectaPage) — nunca para decidir tras un error real,
 * que ya viene cubierto por esErrorAutorizacion. */
export const dejaVentaEnCero = (ajustes: Array<{ cantidadPresentacion: number }>, totalLineas: number): boolean =>
  totalLineas > 0 && ajustes.every((a) => a.cantidadPresentacion === 0) && ajustes.length === totalLineas

/** Brief 2.4: "marcar visualmente los que llevan mucho tiempo abiertos" — el flujo de
 * traslados tiene 9 de 12 sin cerrar sin esta presión visual; el umbral es deliberadamente
 * agresivo (15 min) para que no se repita el patrón. */
export const VTD_ANTIGUEDAD_AVISO_MIN = 15

export const antiguedadMinutos = (creadoEn: string): number => Math.floor((Date.now() - new Date(creadoEn).getTime()) / 60000)
