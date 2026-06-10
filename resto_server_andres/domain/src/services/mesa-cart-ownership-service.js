export async function transferClientCartItems(repository, mesaSesionId, sourceClientSessionId, targetClientSessionId) {
  if (!sourceClientSessionId || !targetClientSessionId || sourceClientSessionId === targetClientSessionId) {
    return {
      transferredItemsCount: 0,
      targetClientSessionId,
    };
  }

  const sourceRows = await repository.listOwnedCartRows(mesaSesionId, sourceClientSessionId);

  let transferredItemsCount = 0;

  for (const row of sourceRows) {
    const targetRow = await repository.getCartItemByOwner(
      mesaSesionId,
      row.producto_id,
      targetClientSessionId,
    );

    if (targetRow) {
      await repository.incrementCartItem(targetRow.id, Number(row.cantidad));
      await repository.deleteCartItem(row.id);
    } else {
      await repository.reassignCartItemOwner(row.id, targetClientSessionId);
    }

    transferredItemsCount += Number(row.cantidad);
  }

  return {
    transferredItemsCount,
    targetClientSessionId,
  };
}

export async function orphanMesaCartItems(repository, mesaSesionId) {
  const rows = await repository.orphanMesaCartItems(mesaSesionId);

  return rows.reduce(
    (accumulator, row) => accumulator + Number(row.cantidad ?? 0),
    0,
  );
}

export async function adoptOrphanCartItems(repository, mesaSesionId, targetClientSessionId) {
  if (!targetClientSessionId) {
    return 0;
  }

  const orphanRows = await repository.listOrphanCartRows(mesaSesionId);

  let adoptedItemsCount = 0;

  for (const row of orphanRows) {
    const targetRow = await repository.getCartItemByOwner(
      mesaSesionId,
      row.producto_id,
      targetClientSessionId,
    );

    if (targetRow) {
      await repository.incrementCartItem(targetRow.id, Number(row.cantidad));
      await repository.deleteCartItem(row.id);
    } else {
      await repository.reassignCartItemOwner(row.id, targetClientSessionId);
    }

    adoptedItemsCount += Number(row.cantidad);
  }

  return adoptedItemsCount;
}

export async function applyCartOwnershipOnConfirmedDeparture(
  repository,
  mesaSesionId,
  departingClientSessionId,
  nextLeaderClientSessionId,
  connectedClients,
) {
  if (connectedClients === 0) {
    const orphanedItemsCount = await orphanMesaCartItems(repository, mesaSesionId);

    return {
      mode: 'orphaned',
      itemCount: orphanedItemsCount,
      ownerClientSessionId: null,
    };
  }

  if (nextLeaderClientSessionId) {
    const transferResult = await transferClientCartItems(
      repository,
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
