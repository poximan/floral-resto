import { createPluginConfigDbAdapter } from '../db/adapters/plugin-config-db-adapter.js';
import { DomainError } from './domain-error.js';

const mesaLayoutPluginId = 'mesa-layout-konva';

async function publishPluginConfigChanged(client, publishDomainEvent, reason) {
  if (!publishDomainEvent) {
    return;
  }

  await publishDomainEvent(client, {
    type: 'internal_plugin_config_changed',
    pluginId: mesaLayoutPluginId,
    reason,
  });
}

function mapPluginConfig(row) {
  if (!row) {
    throw new DomainError(404, 'El plugin operativo no existe');
  }

  return {
    pluginId: row.plugin_id,
    enabled: row.habilitado,
    config: row.configuracion_json,
    updatedAt: row.updated_at,
  };
}

function normalizeMesaLayoutConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new DomainError(400, 'La configuracion del mapa de mesas es invalida');
  }

  const salon = config.salon;
  const mesas = config.mesas;

  if (!salon || typeof salon !== 'object' || Array.isArray(salon)) {
    throw new DomainError(400, 'La configuracion del salon es obligatoria');
  }

  if (!Array.isArray(mesas)) {
    throw new DomainError(400, 'La lista visual de mesas es obligatoria');
  }

  const width = Number(salon.width);
  const height = Number(salon.height);
  const gridSize = Number(salon.gridSize);

  if (![width, height, gridSize].every((value) => Number.isFinite(value) && value > 0)) {
    throw new DomainError(400, 'Las dimensiones del mapa de mesas son invalidas');
  }

  const usedMesaIds = new Set();

  return {
    version: 1,
    salon: {
      width,
      height,
      gridSize,
    },
    mesas: mesas.map((mesa) => {
      const mesaId = Number(mesa.mesaId);
      const x = Number(mesa.x);
      const y = Number(mesa.y);
      const mesaWidth = Number(mesa.width);
      const mesaHeight = Number(mesa.height);
      const rotation = Number(mesa.rotation ?? 0);

      if (![mesaId, x, y, mesaWidth, mesaHeight, rotation].every(Number.isFinite)) {
        throw new DomainError(400, 'Una mesa visual tiene coordenadas invalidas');
      }

      if (!Number.isInteger(mesaId) || mesaId <= 0 || mesaWidth <= 0 || mesaHeight <= 0) {
        throw new DomainError(400, 'Una mesa visual tiene dimensiones invalidas');
      }

      if (x < 0 || y < 0 || x + mesaWidth > width || y + mesaHeight > height) {
        throw new DomainError(400, 'Una mesa visual queda fuera del salon');
      }

      if (usedMesaIds.has(mesaId)) {
        throw new DomainError(400, 'El mapa de mesas tiene mesas duplicadas');
      }
      usedMesaIds.add(mesaId);

      return {
        mesaId,
        x,
        y,
        width: mesaWidth,
        height: mesaHeight,
        rotation,
      };
    }),
  };
}

async function getMesaLayoutPlugin(db) {
  return db.withConnection(async ({ repository }) =>
    mapPluginConfig(await repository.getPluginConfig(mesaLayoutPluginId)));
}

async function updateMesaLayoutPluginEnabled(db, recordAuditEvent, publishDomainEvent, enabled, actorNombre) {
  if (typeof enabled !== 'boolean') {
    throw new DomainError(400, 'El estado del plugin es obligatorio');
  }

  return db.withTransaction(async ({ client, repository }) => {
    const row = await repository.updatePluginEnabled(mesaLayoutPluginId, enabled);

    await recordAuditEvent(client, {
      agregado: 'plugins_operativos',
      agregadoId: mesaLayoutPluginId,
      evento: enabled ? 'plugin_enchufado' : 'plugin_desenchufado',
      actorTipo: 'encargado',
      actorReferencia: actorNombre ?? 'encargado',
      payload: {
        pluginId: mesaLayoutPluginId,
      },
    });

    await publishPluginConfigChanged(client, publishDomainEvent, enabled ? 'plugin_enchufado' : 'plugin_desenchufado');

    return mapPluginConfig(row);
  });
}

async function updateMesaLayoutPluginConfig(db, recordAuditEvent, publishDomainEvent, config, actorNombre) {
  const normalizedConfig = normalizeMesaLayoutConfig(config);

  return db.withTransaction(async ({ client, repository }) => {
    const currentPlugin = mapPluginConfig(await repository.getPluginConfigForUpdate(mesaLayoutPluginId));
    if (!currentPlugin.enabled) {
      throw new DomainError(409, 'El plugin de mapa de mesas esta desenchufado');
    }

    const mesaIds = new Set(await repository.listMesaIds());
    const hasInvalidMesaId = normalizedConfig.mesas.some((mesa) => !mesaIds.has(mesa.mesaId));
    if (hasInvalidMesaId) {
      throw new DomainError(400, 'El mapa de mesas referencia una mesa inexistente');
    }

    const row = await repository.updatePluginConfig(mesaLayoutPluginId, normalizedConfig);

    await recordAuditEvent(client, {
      agregado: 'plugins_operativos',
      agregadoId: mesaLayoutPluginId,
      evento: 'plugin_mapa_mesas_actualizado',
      actorTipo: 'mozo',
      actorReferencia: actorNombre ?? 'mozo',
      payload: {
        pluginId: mesaLayoutPluginId,
        mesasUbicadasCount: normalizedConfig.mesas.length,
      },
    });

    await publishPluginConfigChanged(client, publishDomainEvent, 'plugin_mapa_mesas_actualizado');

    return mapPluginConfig(row);
  });
}

export function createPluginConfigService(pool, recordAuditEvent, publishDomainEvent) {
  const db = createPluginConfigDbAdapter(pool);

  return {
    getMesaLayoutPlugin: () => getMesaLayoutPlugin(db),
    updateMesaLayoutPluginEnabled: (enabled, actorNombre) =>
      updateMesaLayoutPluginEnabled(db, recordAuditEvent, publishDomainEvent, enabled, actorNombre),
    updateMesaLayoutPluginConfig: (config, actorNombre) =>
      updateMesaLayoutPluginConfig(db, recordAuditEvent, publishDomainEvent, config, actorNombre),
  };
}
