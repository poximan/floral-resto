import { createMesaOrderService } from './mesa-order-service.js';
import { createMesaSessionService } from './mesa-session-service.js';
import { createMesaSupportService } from './mesa-support-service.js';

export function createMesaService(pool, config, recordAuditEvent, publishDomainEvent) {
  const sessionService = createMesaSessionService(pool, config, recordAuditEvent, publishDomainEvent);
  const orderService = createMesaOrderService(pool, recordAuditEvent, publishDomainEvent);
  const supportService = createMesaSupportService(pool, recordAuditEvent, publishDomainEvent);

  return {
    ...sessionService,
    ...orderService,
    ...supportService,
  };
}
