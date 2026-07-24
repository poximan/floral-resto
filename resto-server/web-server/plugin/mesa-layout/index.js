import MesaLayoutPlugin from './MesaLayoutPlugin.vue';

export const mesaLayoutPluginManifest = {
  id: 'mesa-layout-konva',
  titulo: 'Mapa grafico de mesas',
  version: '0.1.0',
};

export const defaultMesaLayoutState = {
  version: 1,
  salon: {
    width: 920,
    height: 520,
    gridSize: 40,
  },
  mesas: [],
};

export function normalizeMesaLayoutState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('La configuracion del mapa de mesas es invalida');
  }

  const salon = value.salon;
  const mesas = value.mesas;

  if (!salon || typeof salon !== 'object' || Array.isArray(salon)) {
    throw new Error('La configuracion del salon es invalida');
  }

  if (!Array.isArray(mesas)) {
    throw new Error('La lista visual de mesas es invalida');
  }

  const salonWidth = Number(salon.width);
  const salonHeight = Number(salon.height);
  const gridSize = Number(salon.gridSize);

  if (![salonWidth, salonHeight, gridSize].every((item) => Number.isFinite(item) && item > 0)) {
    throw new Error('Las dimensiones del mapa de mesas son invalidas');
  }

  const usedMesaIds = new Set();

  return {
    version: 1,
    salon: {
      width: salonWidth,
      height: salonHeight,
      gridSize,
    },
    mesas: mesas.map((mesa) => {
      const mesaId = Number(mesa.mesaId);
      const x = Number(mesa.x);
      const y = Number(mesa.y);
      const width = Number(mesa.width);
      const height = Number(mesa.height);
      const rotation = Number(mesa.rotation);

      if (![mesaId, x, y, width, height, rotation].every(Number.isFinite)) {
        throw new Error('Una mesa visual tiene coordenadas invalidas');
      }

      if (!Number.isInteger(mesaId) || mesaId <= 0 || width <= 0 || height <= 0) {
        throw new Error('Una mesa visual tiene dimensiones invalidas');
      }

      if (x < 0 || y < 0 || x + width > salonWidth || y + height > salonHeight) {
        throw new Error('Una mesa visual queda fuera del salon');
      }

      if (usedMesaIds.has(mesaId)) {
        throw new Error('El mapa de mesas tiene mesas duplicadas');
      }
      usedMesaIds.add(mesaId);

      return {
        mesaId,
        x,
        y,
        width,
        height,
        rotation,
      };
    }),
  };
}

export { MesaLayoutPlugin };
