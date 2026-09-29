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
| `+` / `-` | Sumar o restar 1 a la cantidad de la línea seleccionada o, si no hay, la última |
| `F4` (o `Alt + P`) | Editar el precio de la línea activa (modos Venta y Venta directa; no en Traslado) |
| `*` (o `Alt + Q`) | Fijar la cantidad exacta de la línea activa (todos los modos) |
| `F3` (o `Alt + L`) | Abrir el editor completo de la línea activa: descuento %, origen y nota (modos Venta y Venta directa) |
| `Supr` (Delete) | Eliminar la línea seleccionada |
| `Ctrl + Z` | Deshacer el último producto agregado |
| `F7` (o `Alt + U`) | Enfocar el descuento general |
| `F10` (o `Alt + I`) | Agregar ítem personalizado (solo modo Venta) |

La «línea activa» es la seleccionada o, si no hay selección, la última del carrito (se
resalta antes de actuar). `Supr` nunca cae a la última línea: solo borra una línea
seleccionada explícitamente. Al confirmar o cancelar con `Enter` / `Escape` el precio o la
cantidad en línea, o al cerrar el editor abierto con `F3`, el foco vuelve al buscador y la
línea sigue seleccionada, para seguir escaneando sin mouse. `*` no choca con el prefijo
`N*` del escáner: solo actúa con el buscador vacío.

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
compatibilidad. `F3` es «buscar siguiente» en Chrome (se anula con `preventDefault`). `F3`, `F4`, `F6`, `F7` y `F10` tienen un respaldo (`Alt + L`, `Alt + P`, `Alt + C`, `Alt + U`, `Alt + I`)
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

`Alt + D`, `Alt + E` y `Alt + F` no se usan: Chrome los reserva (barra de direcciones y menú).

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
