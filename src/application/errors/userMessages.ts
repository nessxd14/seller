import { toAppError, type AppErrorCode } from './AppError'

const messages: Record<AppErrorCode,string> = {
  unauthenticated:'Inicia sesión para continuar.',
  unauthorized:'No tienes permiso para realizar esta acción.',
  inactive_user:'Tu usuario está inactivo. Contacta a un administrador.',
  validation:'Revisa los datos ingresados.',
  not_found:'El registro ya no está disponible.',
  conflict:'Otra persona modificó este registro.',
  insufficient_stock:'No hay stock suficiente para completar la operación.',
  reservation_expired:'La reserva venció y debe recalcularse.',
  duplicate_operation:'Esta operación ya fue procesada.',
  session_expired:'Tu sesión venció. Vuelve a iniciar sesión.',
  cash_session_required:'Debes abrir una sesión de caja.',
  network:'No hay conexión. Conservaremos tu intento para reintentarlo.',
  timeout:'La operación tardó demasiado. Puedes reintentarla.',
  backend_unavailable:'El servicio está temporalmente fuera de línea.',
}
export const userMessageForError = (error: unknown) => messages[toAppError(error).code]
