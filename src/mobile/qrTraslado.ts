import { qrContentForTraslado } from '../domain/documents/qrContent'

/** El QR del traslado o el motivo por el que no se puede armar (id inválido, dirección de Almacén mal configurada). */
export function contenidoQrTraslado(id: string): { ok: true; enlace: string } | { ok: false; error: string } {
  try { return { ok: true, enlace: qrContentForTraslado(id) } } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'No se pudo armar el QR del traslado.' } }
}
