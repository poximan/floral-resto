import { createWaiterCallService } from './waiter-call-service.js';
import { createWaiterConsultaService } from './waiter-consulta-service.js';
import { createWaiterKitchenService } from './waiter-kitchen-service.js';
import { createWaiterQueueService } from './waiter-queue-service.js';

export function createWaiterService(pool, recordAuditEvent, publishDomainEvent) {
  const queueService = createWaiterQueueService(pool);
  const consultaService = createWaiterConsultaService(pool, recordAuditEvent, publishDomainEvent);
  const kitchenService = createWaiterKitchenService(pool, recordAuditEvent, publishDomainEvent);
  const callService = createWaiterCallService(pool, recordAuditEvent, publishDomainEvent);

  return {
    ...queueService,
    ...consultaService,
    ...kitchenService,
    ...callService,
  };
}
