# QR de Traslados del carrito

El traslado creado desde Seller conserva su resultado después de limpiar el carrito y muestra inmediatamente su QR. El mismo QR aparece en el detalle y en el documento imprimible; usa el identificador de `solicitud_traslado`, no el de un Pedido ni un TV.

El enlace abre `/operaciones/traslados/:id?escanear=1` en `VITE_ALMACEN_URL` (por defecto `https://almacen-cation.vercel.app`). Almacén alista sin mover stock; una segunda cuenta confirma al recibir el material directamente del almacenero. Esa confirmación descuenta origen y acredita destino una sola vez. No hay tercer actor ni recepción posterior en Tienda.

La API y la pantalla móvil se implementan en el PR compañero de `nessxd14/almacen_cation`, rama `codex/traslados-qr-dos-responsables`. Su guía `docs/traslados-qr-dos-responsables.md` detalla permisos, fotos independientes en tema Telegram 17226, pendientes y publicación. Seller conserva el servicio de creación y no introduce escrituras nuevas de stock.

Publicar coordinadamente con Almacén: migración `20261021195840_traslados_qr_entrega_dos_personas.sql`, worker de operaciones y ambos frontends, y activar la bandera `traslados_qr` al final con autorización. Su valor inicial false permite revisar/publicar sin adoptar todavía el nuevo circuito. Los traslados históricos ya en tránsito conservan su recepción anterior. Si falta la API, el enlace muestra un mensaje de circuito todavía no disponible.

Validación: suite Vitest completa (726 pruebas aprobadas, 7 omitidas), TypeScript/Vite y ESLint de archivos modificados. Incluye creación real con el proveedor del carrito, limpieza sin perder el QR, enlaces válidos y documentos impresos por estado. La operación física y los dispositivos reales quedan para el piloto tras activar el backend.
