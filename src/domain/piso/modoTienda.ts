import type { MockRole } from '../../application/auth/AuthSessionProvider'

/** Bandera por usuario en este celular: «Modo tienda» = ver el Seller como un reponedor. */
export const claveModoTienda = (userId: string): string => `seller:modo-tienda:${userId}`

export function leerModoTienda(userId: string | undefined): boolean {
  if (!userId) return false
  try { return localStorage.getItem(claveModoTienda(userId)) === '1' } catch { return false }
}

export function activarModoTienda(userId: string): void {
  try { localStorage.setItem(claveModoTienda(userId), '1') } catch { /* sin almacenamiento: el modo dura lo que dure la pantalla */ }
}

export function desactivarModoTienda(userId: string): void {
  try { localStorage.removeItem(claveModoTienda(userId)) } catch { /* nada que limpiar */ }
}

/** Reponedor y vendedor viven siempre en el piso: no ven la banda ni el botón de volver. */
export const veBandaModoTienda = (role: MockRole): boolean => role !== 'reponedor' && role !== 'vendedor'
