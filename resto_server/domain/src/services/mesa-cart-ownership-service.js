export async function transferClientCartItems(
  client,
  mesaSesionId,
  sourceClientSessionId,
  targetClientSessionId,
) {
  if (!sourceClientSessionId || !targetClientSessionId || sourceClientSessionId === targetClientSessionId) {
    return {
      transferredItemsCount: 0,
      targetClientSessionId,
    };
  }

  const sourceRowsResult = await client.query(
    `
      SELECT id, producto_id, cantidad
      FROM mesa_carrito_items
      WHERE mesa_sesion_id = $1
        AND cliente_sesion_id = $2
      ORDER BY created_at ASC, id ASC
    `,
    [mesaSesionId, sourceClientSessionId],
  );

  let transferredItemsCount = 0;

  for (const row of sourceRowsResult.rows) {
    const targetRowResult = await client.query(
      `
        SELECT id, cantidad
        FROM mesa_carrito_items
        WHERE mesa_sesion_id = $1
          AND producto_id = $2
          AND cliente_sesion_id = $3
        LIMIT 1
      `,
      [mesaSesionId, row.producto_id, targetClientSessionId],
    );

    const targetRow = targetRowResult.rows[0] ?? null;

    if (targetRow) {
      await client.query(
        `
          UPDATE mesa_carrito_items
          SET cantidad = cantidad + $2,
              updated_at = NOW()
          WHERE id = $1
        `,
        [targetRow.id, Number(row.cantidad)],
      );

      await client.query(
        `
          DELETE FROM mesa_carrito_items
          WHERE id = $1
        `,
        [row.id],
      );
    } else {
      await client.query(
        `
          UPDATE mesa_carrito_items
          SET cliente_sesion_id = $2,
              updated_at = NOW()
          WHERE id = $1
        `,
        [row.id, targetClientSessionId],
      );
    }

    transferredItemsCount += Number(row.cantidad);
  }

  return {
    transferredItemsCount,
    targetClientSessionId,
  };
}

export async function orphanMesaCartItems(client, mesaSesionId) {
  const result = await client.query(
    `
      UPDATE mesa_carrito_items
      SET cliente_sesion_id = NULL,
          updated_at = NOW()
      WHERE mesa_sesion_id = $1
      RETURNING cantidad
    `,
    [mesaSesionId],
  );

  return result.rows.reduce(
    (accumulator, row) => accumulator + Number(row.cantidad ?? 0),
    0,
  );
}

export async function adoptOrphanCartItems(client, mesaSesionId, targetClientSessionId) {
  if (!targetClientSessionId) {
    return 0;
  }

  const orphanRowsResult = await client.query(
    `
      SELECT id, producto_id, cantidad
      FROM mesa_carrito_items
      WHERE mesa_sesion_id = $1
        AND cliente_sesion_id IS NULL
      ORDER BY created_at ASC, id ASC
    `,
    [mesaSesionId],
  );

  let adoptedItemsCount = 0;

  for (const row of orphanRowsResult.rows) {
    const targetRowResult = await client.query(
      `
        SELECT id
        FROM mesa_carrito_items
        WHERE mesa_sesion_id = $1
          AND producto_id = $2
          AND cliente_sesion_id = $3
        LIMIT 1
      `,
      [mesaSesionId, row.producto_id, targetClientSessionId],
    );

    const targetRow = targetRowResult.rows[0] ?? null;

    if (targetRow) {
      await client.query(
        `
          UPDATE mesa_carrito_items
          SET cantidad = cantidad + $2,
              updated_at = NOW()
          WHERE id = $1
        `,
        [targetRow.id, Number(row.cantidad)],
      );

      await client.query(
        `
          DELETE FROM mesa_carrito_items
          WHERE id = $1
        `,
        [row.id],
      );
    } else {
      await client.query(
        `
          UPDATE mesa_carrito_items
          SET cliente_sesion_id = $2,
              updated_at = NOW()
          WHERE id = $1
        `,
        [row.id, targetClientSessionId],
      );
    }

    adoptedItemsCount += Number(row.cantidad);
  }

  return adoptedItemsCount;
}

export async function applyCartOwnershipOnConfirmedDeparture(
  client,
  mesaSesionId,
  departingClientSessionId,
  nextLeaderClientSessionId,
  connectedClients,
) {
  if (connectedClients === 0) {
    const orphanedItemsCount = await orphanMesaCartItems(client, mesaSesionId);

    return {
      mode: 'orphaned',
      itemCount: orphanedItemsCount,
      ownerClientSessionId: null,
    };
  }

  if (nextLeaderClientSessionId) {
    const transferResult = await transferClientCartItems(
      client,
      mesaSesionId,
      departingClientSessionId,
      nextLeaderClientSessionId,
    );

    return {
      mode: 'transferred',
      itemCount: transferResult.transferredItemsCount,
      ownerClientSessionId: nextLeaderClientSessionId,
    };
  }

  return {
    mode: 'unchanged',
    itemCount: 0,
    ownerClientSessionId: null,
  };
}
