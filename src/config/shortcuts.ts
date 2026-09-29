// Fuente única de los atajos del POS: alimenta el panel de atajos (ShortcutsModal)
// y docs/KEYBOARD_SHORTCUTS.md, que debe reflejar exactamente esta tabla.
export interface ShortcutDef {
  id: string
  keys: string[]
  label: string
  group: 'Búsqueda' | 'Carrito' | 'Operación' | 'Modos' | 'Ayuda'
}

export const shortcuts: ShortcutDef[] = [
  { id: 'focus-search', keys: ['F2', '/'], label: 'Enfocar el buscador', group: 'Búsqueda' },
  { id: 'scan-add', keys: ['Escáner', 'Enter'], label: 'Agregar coincidencia exacta por código, SKU, código de fábrica o nombre', group: 'Búsqueda' },
  { id: 'scan-quantity', keys: ['N*', 'Escáner', 'Enter'], label: 'Agregar N unidades del código escaneado (ej. "12*" y escanear)', group: 'Búsqueda' },
  { id: 'move-selection', keys: ['↑', '↓'], label: 'Mover la selección entre las líneas del carrito', group: 'Carrito' },
  { id: 'quantity-step', keys: ['+', '-'], label: 'Sumar o restar 1 a la cantidad de la línea seleccionada o, si no hay, la última', group: 'Carrito' },
  { id: 'edit-price', keys: ['F4', 'Alt+P'], label: 'Editar el precio de la línea activa (modos Venta y Venta directa)', group: 'Carrito' },
  { id: 'edit-quantity', keys: ['*', 'Alt+Q'], label: 'Fijar la cantidad exacta de la línea activa', group: 'Carrito' },
  { id: 'edit-line', keys: ['F3', 'Alt+L'], label: 'Abrir el editor completo de la línea activa: descuento %, origen y nota (modos Venta y Venta directa)', group: 'Carrito' },
  { id: 'remove-line', keys: ['Supr'], label: 'Eliminar la línea seleccionada', group: 'Carrito' },
  { id: 'undo-add', keys: ['Ctrl+Z'], label: 'Deshacer el último producto agregado', group: 'Carrito' },
  { id: 'focus-discount', keys: ['F7', 'Alt+U'], label: 'Enfocar el descuento general', group: 'Carrito' },
  { id: 'custom-item', keys: ['F10', 'Alt+I'], label: 'Agregar ítem personalizado (solo modo Venta)', group: 'Carrito' },
  { id: 'suspend', keys: ['F8'], label: 'Suspender la operación actual', group: 'Operación' },
  { id: 'pay', keys: ['F9', 'Ctrl+Enter'], label: 'Abrir cobro (o traslado / venta directa según el modo)', group: 'Operación' },
  { id: 'new-operation', keys: ['Alt+N'], label: 'Nueva operación, con confirmación si hay carrito', group: 'Operación' },
  { id: 'cancel-sale', keys: ['Ctrl+Shift+Supr'], label: 'Cancelar la venta actual', group: 'Operación' },
  { id: 'customer-picker', keys: ['F6', 'Alt+C'], label: 'Abrir el selector de cliente', group: 'Operación' },
  { id: 'confirm-payment', keys: ['Enter'], label: 'Confirmar el cobro, cuando el botón está habilitado', group: 'Operación' },
  { id: 'mode-venta', keys: ['Alt+V'], label: 'Cambiar a modo Venta', group: 'Modos' },
  { id: 'mode-traslado', keys: ['Alt+T'], label: 'Cambiar a modo Traslado', group: 'Modos' },
  { id: 'mode-venta-directa', keys: ['Alt+R'], label: 'Cambiar a modo Venta directa de Almacén', group: 'Modos' },
  { id: 'shortcuts-panel', keys: ['F1', '?'], label: 'Abrir este panel de atajos', group: 'Ayuda' },
  { id: 'close-modal', keys: ['Escape'], label: 'Cerrar el modal activo', group: 'Ayuda' },
]
