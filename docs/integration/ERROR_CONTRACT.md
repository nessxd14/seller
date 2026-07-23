# Contrato de errores

| Código | Clase | Uso |
|---|---|---|
| `unauthenticated` | `UnauthenticatedError` | No existe sesión |
| `unauthorized` | `UnauthorizedError` | Falta permiso |
| `validation` | `ValidationError` | Entrada inválida |
| `not_found` | `NotFoundError` | Recurso inexistente |
| `conflict` | `ConflictError` | Versión desactualizada |
| `insufficient_stock` | `InsufficientStockError` | Disponibilidad insuficiente |
| `reservation_expired` | `ReservationExpiredError` | Reserva vencida |
| `duplicate_operation` | `DuplicateOperationError` | Reintento ya procesado o doble clic |
| `session_expired` | `SessionExpiredError` | Sesión vencida |
| `cash_session_required` | `CashSessionRequiredError` | Operación sin caja abierta |
| `network` | `NetworkError` | Sin conectividad |
| `backend_unavailable` | `BackendUnavailableError` | Servicio temporalmente caído |

`userMessageForError` centraliza mensajes seguros. Un conflicto ofrece recargar, conservar una copia local o cancelar.

