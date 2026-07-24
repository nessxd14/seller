# Matriz de roles para UX

> Estas reglas ocultan o bloquean acciones en la interfaz. El backend debe volver a validar todas las operaciones.

| Capacidad | Admin | Supervisor | Cajero | Vendedor mayoreo | Almacén | Auditor | Operario |
|---|---:|---:|---:|---:|---:|---:|---:|
| Venta Retail | ✓ | ✓ | ✓ | — | — | lectura | — |
| Venta Mayoreo/Institucional | ✓ | ✓ | — | ✓ | — | lectura | — |
| Cotizaciones | ✓ | ✓ | — | ✓ | — | lectura | lectura |
| Ver pedidos | ✓ | ✓ | — | ✓ | ✓ | lectura | lectura |
| Preparar/despachar | ✓ | ✓ | — | — | ✓ | — | — |
| Caja propia | ✓ | ✓ | ✓ | — | — | lectura | — |
| Supervisar caja | ✓ | ✓ | — | — | — | lectura | — |
| Cambiar precios | ✓ | ✓ | — | — | — | — | — |
| Anular/devolver | ✓ | ✓ | — | — | — | lectura | — |

Usuario inactivo queda bloqueado con un estado dedicado. Un usuario sin perfil queda sin permisos y ve acceso restringido. Sin sesión o sesión expirada muestra una pantalla dedicada. El selector existe solo para desarrollo y pruebas.
