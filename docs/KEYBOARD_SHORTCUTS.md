# Atajos del POS ROARI

El POS se puede usar completo desde el teclado (mostrador con escáner de código de
barras). La misma tabla se muestra desde el POS con `F1` o el ícono de teclado del
encabezado, y está definida una sola vez en `src/config/shortcuts.ts`.

## Búsqueda

| Atajo | Acción |
|---|---|
| `F2` o `/` | Enfocar el buscador |
| Escáner + `Enter` | Agregar coincidencia exacta por código de barras, SKU, código de fábrica o nombre |
| `N*` + escáner + `Enter` | Agregar N unidades de una sola pasada (ej. `12*` y escanear agrega 12 unidades) |

## Carrito

| Atajo | Acción |
|---|---|
| `↑` / `↓` | Mover la selección entre las líneas del carrito |
| `+` / `-` | Sumar o restar 1 a la cantidad de la línea seleccionada |
| `Supr` (Delete) | Eliminar la línea seleccionada |
| `Ctrl + Z` | Deshacer el último producto agregado |
| `F7` (o `Alt + U`) | Enfocar el descuento general |
| `F10` (o `Alt + I`) | Agregar ítem personalizado (solo modo Venta) |

Los atajos de carrito están activos fuera de campos editables, o con el foco en el
buscador cuando está vacío (para poder usarlos justo después de escanear sin romper la
escritura normal — los SKU llevan guiones).

## Operación

| Atajo | Acción |
|---|---|
| `F8` | Suspender la operación actual |
| `F9` o `Ctrl + Enter` | Abrir cobro (o el paso equivalente en modo Traslado / Venta directa) |
| `Alt + N` (o `Ctrl + N`) | Nueva operación, con confirmación si hay productos en el carrito |
| `Ctrl + Shift + Supr` | Cancelar la venta actual |
| `F6` (o `Alt + C`) | Abrir el selector de cliente |
| `Enter` | Confirmar el cobro en el modal de pago, solo si el botón está habilitado |

`Ctrl + N` lo reserva Chrome para abrir una ventana nueva y nunca llega a la página —
`Alt + N` es el atajo que realmente funciona; el handler de `Ctrl + N` se mantiene por
compatibilidad. `F6`, `F7` y `F10` tienen un respaldo (`Alt + C`, `Alt + U`, `Alt + I`)
cableado en paralelo: no fue posible confirmar en un Chrome de escritorio real sobre
Windows si esas teclas de función llegan a la página en este entorno de desarrollo
(sandbox sin navegador de escritorio), así que ambos atajos quedan activos siempre en
vez de depender de una detección en tiempo de ejecución.

## Modos

| Atajo | Acción |
|---|---|
| `Alt + V` | Cambiar a modo Venta |
| `Alt + T` | Cambiar a modo Traslado |
| `Alt + R` | Cambiar a modo Venta directa de Almacén (si el feature flag está activo) |

`Alt + D` no se usa: Chrome lo reserva para enfocar la barra de direcciones.

## Ayuda

| Atajo | Acción |
|---|---|
| `F1` o `?` | Abrir este panel de atajos |
| `Escape` | Cerrar el modal activo |

## Notas

- Los dígitos que entrega el escáner nunca son atajos por sí mismos — solo importan
  dentro del buscador, seguidos de `Enter`.
- Un `Enter` suelto (sin estar en el buscador o en el modal de pago habilitado) nunca
  cobra nada.
- `F5` es intencionalmente el único atajo "no usado": recargar la página pierde
  cualquier cambio sin guardar, así que no se le asigna ninguna acción.
- Ningún atajo salta una validación o confirmación: si el botón equivalente está
  deshabilitado (caja cerrada, línea sin precio, stock insuficiente, ítem
  personalizado, etc.), su atajo tampoco hace nada.
