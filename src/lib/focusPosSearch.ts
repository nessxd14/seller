// Devuelve el foco al buscador del POS para seguir escaneando sin mouse. Un solo lugar
// para el selector — lo usan los editores en línea del carrito y el modal de edición.
export const focusPosSearch = () => document.querySelector<HTMLInputElement>('.global-search input')?.focus()
