export type AppErrorCode =
  | 'unauthenticated' | 'unauthorized' | 'validation' | 'not_found' | 'conflict'
  | 'insufficient_stock' | 'reservation_expired' | 'duplicate_operation'
  | 'session_expired' | 'cash_session_required' | 'network' | 'backend_unavailable'

export abstract class AppError extends Error {
  abstract readonly code: AppErrorCode
  constructor(message: string, readonly details?: Record<string, unknown>) { super(message); this.name = new.target.name }
}
export class UnauthenticatedError extends AppError { readonly code='unauthenticated' as const }
export class UnauthorizedError extends AppError { readonly code='unauthorized' as const }
export class ValidationError extends AppError { readonly code='validation' as const }
export class NotFoundError extends AppError { readonly code='not_found' as const }
export class ConflictError extends AppError { readonly code='conflict' as const }
export class InsufficientStockError extends AppError { readonly code='insufficient_stock' as const }
export class ReservationExpiredError extends AppError { readonly code='reservation_expired' as const }
export class DuplicateOperationError extends AppError { readonly code='duplicate_operation' as const }
export class SessionExpiredError extends AppError { readonly code='session_expired' as const }
export class CashSessionRequiredError extends AppError { readonly code='cash_session_required' as const }
export class NetworkError extends AppError { readonly code='network' as const }
export class BackendUnavailableError extends AppError { readonly code='backend_unavailable' as const }

export const toAppError = (error: unknown): AppError => {
  if (error instanceof AppError) return error
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) return new NetworkError('No fue posible comunicarse con el servicio')
  return new BackendUnavailableError('El servicio no está disponible temporalmente')
}

