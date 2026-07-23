import type { EntityId, ISODateTime } from '../common/types'

export interface User { id: EntityId; name: string; active: boolean; roleIds: EntityId[] }
export interface Role { id: EntityId; name: string; permissionIds: EntityId[] }
export interface Permission { id: EntityId; code: string; description: string }
export interface AuditLog { id: EntityId; actorUserId?: EntityId; action: string; entityType: string; entityId: EntityId; occurredAt: ISODateTime; before?: unknown; after?: unknown; reason?: string; correlationId: string }
export interface DocumentSequence { id: EntityId; documentType: string; locationId?: EntityId; prefix: string; nextNumber: number; version: number }

