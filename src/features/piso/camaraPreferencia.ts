/** Clave por dispositivo: el reponedor decide si la cámara arranca abierta o cerrada. */
export const CLAVE_CAMARA = 'piso:camara'

/** Abierta salvo que este dispositivo la haya cerrado. Sin almacenamiento, abierta. */
export function leerCamaraAbierta(): boolean {
  try { return window.localStorage.getItem(CLAVE_CAMARA) !== 'cerrada' } catch { return true }
}

export function guardarCamaraAbierta(abierta: boolean): void {
  try { window.localStorage.setItem(CLAVE_CAMARA, abierta ? 'abierta' : 'cerrada') } catch { /* sin almacenamiento: no se recuerda */ }
}
