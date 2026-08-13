// Brief T3 Tarea 4: el buscador de las grillas (Cotizaciones/Pedidos/Traslados) tiene que
// encontrar tanto por el número completo (PED-2026-00275) como por el sufijo suelto que la
// gente realmente tipea (275, 00275) — nadie va a escribir el prefijo y el año. Si el
// término es solo dígitos se compara por valor contra el sufijo numérico del número
// (00275 y 275 son el mismo número); si no, substring case-insensitive contra el número
// completo.
export const matchesNumero = (numero: string, term: string): boolean => {
  const trimmed = term.trim()
  if (!trimmed) return true
  if (/^\d+$/.test(trimmed)) {
    const suffix = numero.match(/(\d+)$/)?.[1]
    return suffix != null && Number(suffix) === Number(trimmed)
  }
  return numero.toLowerCase().includes(trimmed.toLowerCase())
}
