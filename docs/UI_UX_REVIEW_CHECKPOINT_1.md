# Revisión de UI y UX después del Checkpoint 1

Fecha: 26 de septiembre de 2026.

Base guardada: `6269e4c`, etiqueta `checkpoint-1`. La revisión incluye las mejoras CSS posteriores que están en el espacio de trabajo. Esta revisión no modifica la interfaz.

## Implementación posterior aprobada

Los puntos siguientes se implementaron en la ronda solicitada después de la revisión:

- Cabecera común sobre catálogo y carrito, con controles de 42 px.
- Eje derecho compartido por los importes y filas de carrito compactas, con controles estables.
- Fila de chips y espacio de indicadores reservados para evitar saltos del catálogo.
- Estado de cliente obligatorio con texto y color propios.
- Zonas de clic ampliadas y acciones Glass en las ventanas.
- Foco contenido, restauración de foco y Escape en la ventana compartida y la ficha de producto.
- Selector de origen del carrito renderizado fuera del área que recorta el contenido.

Verificación: compilación correcta; ESLint de los archivos modificados; tres pruebas de teclado (incluyen ventanas anidadas y `escapeToClose`); navegador en las cuatro resoluciones, con cabecera alineada, importes sobre el mismo eje y controles sin desbordamiento. También se comprobaron selección de origen, edición, cantidades de varios dígitos, eliminación, colapso del resumen y navegación a Configuración.

El Checkpoint 1 conserva el estado anterior a esta implementación. Los hallazgos originales se mantienen debajo como registro de las decisiones.

Se revisó el POS local con datos simulados en Chrome, a 1672×941, 1536×864, 1366×768 y 1280×720. Se comprobaron geometría, estados del carrito y navegación con teclado. Los flujos con datos reales y dispositivos táctiles quedan fuera de esta revisión.

## Prioridades de interacción

### 1. Mantener el foco dentro de las ventanas — alta

Al abrir Registrar cobro, Tab llega primero a Sesión mock y Simular conflicto, detrás de la ventana. Después de Confirmar cobro vuelve a la navegación de fondo. La ficha de información del producto tampoco se cierra con Escape.

Propuesta: llevar el foco al primer control apropiado al abrir, contener Tab y Shift+Tab dentro del diálogo, devolver el foco al disparador al cerrar y unificar Escape. Conservar el tratamiento existente de ventanas anidadas.

Referencias: `src/components/Modal.tsx`, `src/components/ProductInfoPopover.tsx`.

### 2. Recuperar el estado de cliente obligatorio — alta

En Institucional, sin cliente seleccionado, el botón tiene la clase `required`, pero su borde y fondo son idénticos a Retail. La capa Glass sobrescribe la señal visual previa.

Propuesta: definir un estado Glass específico para cliente obligatorio y acompañarlo de texto visible. El requisito debe reconocerse sin depender solo del color.

Referencias: `src/components/CustomerPicker.tsx`, `src/pos-glassmorphism.css`.

### 3. Ampliar las zonas de clic — media

Medidas observadas en el carrito: Editar, 10×27 px; Eliminar, 13×37 px; botones de cantidad, 26×24 px. El icono informativo de producto mide 20×20 px según sus estilos.

Propuesta: conservar iconos discretos dentro de botones de al menos 32 px para escritorio y evaluar 40–44 px para uso táctil. Evitar que la ampliación invada controles vecinos.

Referencias: `src/components/CartItem.tsx`, `src/pos-ajustes.css`, `src/pos-carrito-tanda4.css`.

### 4. Evitar movimientos del catálogo al agregar — media

Al añadir el primer producto, aparecen los chips del carrito y el inicio de la grilla baja 36,5 px a 1366×768. Los productos dejan de estar donde el usuario acaba de apuntar.

Propuesta: reservar una fila estable para los chips o situarlos en una zona que no empuje la grilla. Verificar también varias líneas de chips y búsquedas sin resultados.

Referencias: `src/components/ProductCatalog.tsx`, `src/styles/pos-busqueda-fluida.css`.

## Alineación y composición

### 5. Compartir el eje de los importes — media

Subtotal y Descuento ya aprovechan el ancho del panel. El importe Total termina 46 px a su izquierda debido al botón de plegar y al relleno interior. Los importes de las líneas también tienen un margen distinto.

Propuesta: definir un eje derecho común para los números y ubicar el control de plegar junto a la etiqueta o en una zona independiente. Conservar el mayor tamaño del Total y usar cifras tabulares.

Referencias: `src/components/CartPanel.tsx`, `src/pos-resumen-carrito.css`, `src/pos-glassmorphism.css`.

### 6. Estabilizar la estructura de cada línea del carrito — media

La misma línea mide 93 px de alto con el panel ancho y 111 px con el panel compacto. El importe pasa de compartir fila con los controles a ocupar otra fila. Nombres largos y distintas presentaciones pueden aumentar la variación.

Propuesta: definir zonas predecibles para nombre/precio, controles e importe, con una distribución compacta explícita. Comprobar cantidades de varios dígitos, nombres largos, precios negociados y avisos de stock antes de fijar alturas.

Referencias: `src/components/CartItem.tsx`, `src/pos-carrito-tanda4.css`.

### 7. Unificar alturas en la cabecera — baja

Las alturas actuales son: buscador 42 px, Configuración 37 px, Registrar pago 40 px y Nueva operación 38 px. Comparten centro vertical, pero sus bordes no forman una línea común.

Propuesta: establecer una altura compartida de 40 o 42 px y una misma escala de radios y separación. Mantener la prioridad visual de Nueva operación mediante color.

Referencias: `src/components/PosHeader.tsx`, `src/pos-glassmorphism.css`.

### 8. Revisar la simetría entre catálogo y carrito — decisión de diseño

En escritorio, el carrito empieza en y=12 y el catálogo en y=92: una diferencia de 80 px porque la cabecera solo ocupa la columna central. La referencia visual coloca la cabecera sobre ambas columnas.

Propuesta: valorar una cabecera común encima de catálogo y carrito para alinear sus bordes superiores. Requiere revisar la composición del contenedor, los otros módulos y los tamaños compactos; no es un simple ajuste de márgenes.

Referencia: `src/pages/PosPage.tsx`.

### 9. Reducir el espacio anterior a los productos — decisión de diseño

A 1366×768, con un producto agregado, la grilla comienza alrededor de y=386 dentro de un catálogo que empieza en y=80. Título, canal, chips, filtros y encabezado consumen aproximadamente 306 px.

Propuesta: compactar el título/fecha y las separaciones entre grupos en pantallas bajas. Mantener visibles el canal y los filtros, procurando mostrar más productos antes de desplazar.

### 10. Aplicar el mismo acabado a las acciones de las ventanas — baja

Los diálogos se montan bajo `document.body`. Las reglas de botones Glass limitadas a `.pos-root` no alcanzan sus acciones; por ejemplo, Confirmar cobro conserva otro tratamiento visual.

Propuesta: compartir estilos de acciones entre el POS y las ventanas, conservando la distinción entre acciones principales, secundarias, peligrosas y deshabilitadas.

## Orden sugerido para la próxima implementación

1. Teclado en ventanas y estado de cliente obligatorio.
2. Zonas de clic y estabilidad de la grilla al agregar.
3. Eje de importes y distribución de las líneas del carrito.
4. Alturas de cabecera y consistencia de botones.
5. Evaluar cabecera común y compactación del catálogo con una vista comparativa.

## Criterios de comprobación

- Abrir y cerrar ventanas usando solo teclado sin activar el fondo.
- Reconocer el cliente obligatorio en todos los canales pertinentes.
- Añadir productos consecutivamente sin desplazar sus botones por aparición de chips.
- Mantener controles e importes legibles con nombres largos, cantidades grandes y errores de stock.
- Comprobar las cuatro resoluciones revisadas, con carrito vacío, una línea y varias líneas.
- Conservar el acceso al menú completo, a los filtros y al botón Cobrar.
