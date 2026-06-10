import { createVisualConfigDbAdapter } from '../db/adapters/visual-config-db-adapter.js';
import { DomainError } from './domain-error.js';

async function publishMesaPublicRefreshAll(client, publishDomainEvent, reason) {
  if (!publishDomainEvent) {
    return;
  }

  await publishDomainEvent(client, {
    type: 'mesa_public_refresh_all',
    reason,
  });
}

function mapVisualConfig(row) {
  return {
    visualUsdExchangeRate: Number.parseFloat(row?.usd_exchange_rate ?? '0'),
  };
}

async function getVisualConfig(db) {
  return db.withConnection(async ({ repository }) => mapVisualConfig(await repository.getVisualConfig()));
}

async function updateVisualConfig(db, recordAuditEvent, publishDomainEvent, payload, actorNombre) {
  const visualUsdExchangeRate = Number.parseFloat(payload.visualUsdExchangeRate);

  if (!Number.isFinite(visualUsdExchangeRate) || visualUsdExchangeRate <= 0) {
    throw new DomainError(400, 'La cotizacion visual USD debe ser un numero positivo');
  }

  return db.withTransaction(async ({ client, repository }) => {
    await repository.updateVisualUsdExchangeRate(visualUsdExchangeRate);

    await recordAuditEvent(client, {
      agregado: 'configuracion_visual',
      agregadoId: '1',
      evento: 'cotizacion_visual_actualizada',
      actorTipo: 'mozo',
      actorReferencia: actorNombre ?? 'mozo',
      payload: {
        visualUsdExchangeRate,
      },
    });

    await publishMesaPublicRefreshAll(client, publishDomainEvent, 'cotizacion_visual_actualizada');

    return {
      visualUsdExchangeRate,
    };
  });
}

export function createVisualConfigService(pool, recordAuditEvent, publishDomainEvent) {
  const db = createVisualConfigDbAdapter(pool);

  return {
    getVisualConfig: () => getVisualConfig(db),
    updateVisualConfig: (payload, actorNombre) =>
      updateVisualConfig(db, recordAuditEvent, publishDomainEvent, payload, actorNombre),
  };
}
