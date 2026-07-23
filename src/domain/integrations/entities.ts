import type { EntityId, ISODateTime } from '../common/types'

export interface IntegrationJob { id: EntityId; integration: 'zakaeus' | string; operation: string; aggregateType: string; aggregateId: EntityId; idempotencyKey: string; payloadHash: string; status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'dead_letter'; attemptCount: number; nextAttemptAt?: ISODateTime; lastError?: string; createdAt: ISODateTime; completedAt?: ISODateTime }

