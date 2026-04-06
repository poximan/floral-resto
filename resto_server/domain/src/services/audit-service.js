export async function recordAuditEvent(db, payload) {
  await db.query(
    `
      INSERT INTO eventos_auditoria (
        agregado,
        agregado_id,
        evento,
        actor_tipo,
        actor_referencia,
        payload_json
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [
      payload.agregado,
      String(payload.agregadoId),
      payload.evento,
      payload.actorTipo,
      payload.actorReferencia,
      JSON.stringify(payload.payload ?? {}),
    ],
  );
}
