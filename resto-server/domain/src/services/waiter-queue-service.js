import { createWaiterDbAdapter } from '../db/adapters/waiter-db-adapter.js';

export function createWaiterQueueService(pool) {
  const db = createWaiterDbAdapter(pool);

  return {
    getWaiterQueues: async (status) =>
      db.withConnection(async ({ repository }) => {
        const kitchenStatus = status === 'atendido' ? 'atendida' : status;
        const consultaRows = await repository.listConsultaQueue(status);
        const kitchenRows = await repository.listKitchenQueue(kitchenStatus);
        const waiterCallRows = await repository.listWaiterCallQueue(status);

        return {
          status,
          consultas: consultaRows.map((row) => ({
            id: Number(row.id),
            mesaNumero: String(row.mesa_numero),
            mesaSesionId: Number(row.mesa_sesion_id),
            estado: row.estado,
            creadaEn: row.creada_en,
            cerradaEn: row.cerrada_en,
            clienteSesionId: row.cliente_sesion_id,
            clienteNombre: row.cliente_nombre ?? null,
            resumen: row.resumen,
          })),
          pedidosCocina: kitchenRows.map((row) => ({
            id: Number(row.id),
            mesaNumero: String(row.mesa_numero),
            mesaSesionId: Number(row.mesa_sesion_id),
            estado: row.estado,
            creadaEn: row.creada_en,
            atendidaEn: row.atendida_en,
            cobradaEn: row.cobrada_en,
            totalArsCentavos: Number(row.total_ars_centavos),
          })),
          llamadosMozo: waiterCallRows.map((row) => ({
            id: Number(row.id),
            mesaNumero: String(row.mesa_numero),
            mesaSesionId: Number(row.mesa_sesion_id),
            estado: row.estado,
            creadaEn: row.creada_en,
            atendidaEn: row.atendida_en,
            clienteSesionId: row.cliente_sesion_id,
            clienteNombre: row.cliente_nombre ?? null,
          })),
        };
      }),
  };
}
