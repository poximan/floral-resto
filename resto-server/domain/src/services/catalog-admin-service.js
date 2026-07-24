import { createCatalogAdminDbAdapter } from '../db/adapters/catalog-admin-db-adapter.js';
import { DomainError } from './domain-error.js';

function toNumber(value) {
  return Number.parseInt(value, 10);
}

function normalizeText(value) {
  return value?.trim() ?? '';
}

function normalizeCatalogText(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeOptionalText(value) {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed.toLowerCase();
}

function assertPositiveInteger(value, message) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new DomainError(400, message);
  }
}

function mapCategory(row) {
  return {
    id: Number(row.id),
    titulo: row.titulo,
    orden: Number(row.orden),
    activa: row.activa,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProduct(row) {
  return {
    id: Number(row.id),
    subcategoriaId: Number(row.subcategoria_id),
    subcategoriaTitulo: row.subcategoria_titulo,
    categoriaId: Number(row.categoria_id),
    categoriaTitulo: row.categoria_titulo,
    titulo: row.titulo,
    descripcion: row.descripcion,
    precioArsCentavos: Number(row.precio_ars_centavos),
    imagenNombreArchivo: row.imagen_nombre_archivo,
    activo: row.activo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSubcategory(row) {
  return {
    id: Number(row.id),
    categoriaId: Number(row.categoria_id),
    categoriaTitulo: row.categoria_titulo,
    titulo: row.titulo,
    orden: Number(row.orden),
    activa: row.activa,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function publishMesaPublicRefreshAll(client, publishDomainEvent, reason) {
  if (!publishDomainEvent) {
    return;
  }

  await publishDomainEvent(client, {
    type: 'mesa_public_refresh_all',
    reason,
  });
}

async function listCategories(db) {
  return db.withConnection(async ({ repository }) => {
    const rows = await repository.listCategories();
    return rows.map(mapCategory);
  });
}

async function listSubcategories(db) {
  return db.withConnection(async ({ repository }) => {
    const rows = await repository.listSubcategories();
    return rows.map(mapSubcategory);
  });
}

async function createCategory(db, recordAuditEvent, publishDomainEvent, payload, actorNombre) {
  const titulo = normalizeCatalogText(payload.titulo);
  const orden = toNumber(payload.orden);

  if (!titulo) {
    throw new DomainError(400, 'El titulo de la categoria es obligatorio');
  }
  assertPositiveInteger(orden, 'El orden de la categoria debe ser un entero positivo');

  return db.withTransaction(async ({ client, repository }) => {
    const category = await repository.createCategory(titulo, orden);

    await recordAuditEvent(client, {
      agregado: 'categorias',
      agregadoId: category.id,
      evento: 'categoria_creada',
      actorTipo: 'encargado',
      actorReferencia: actorNombre ?? 'encargado',
      payload: {
        titulo,
        orden,
      },
    });

    await publishMesaPublicRefreshAll(client, publishDomainEvent, 'categoria_creada');

    return mapCategory(category);
  });
}

async function updateCategory(db, recordAuditEvent, publishDomainEvent, categoryId, payload, actorNombre) {
  assertPositiveInteger(categoryId, 'La categoria es invalida');

  return db.withTransaction(async ({ client, repository }) => {
    const existing = await repository.getCategoryByIdForUpdate(categoryId);
    if (!existing) {
      throw new DomainError(404, 'La categoria no existe');
    }

    const titulo = normalizeCatalogText(payload.titulo ?? existing.titulo);
    const orden = payload.orden !== undefined ? toNumber(payload.orden) : Number(existing.orden);
    const activa = payload.activa !== undefined ? Boolean(payload.activa) : existing.activa;

    if (!titulo) {
      throw new DomainError(400, 'El titulo de la categoria es obligatorio');
    }
    assertPositiveInteger(orden, 'El orden de la categoria debe ser un entero positivo');

    const category = await repository.updateCategory(categoryId, titulo, orden, activa);

    await recordAuditEvent(client, {
      agregado: 'categorias',
      agregadoId: categoryId,
      evento: 'categoria_actualizada',
      actorTipo: 'encargado',
      actorReferencia: actorNombre ?? 'encargado',
      payload: {
        titulo,
        orden,
        activa,
      },
    });

    await publishMesaPublicRefreshAll(client, publishDomainEvent, 'categoria_actualizada');

    return mapCategory(category);
  });
}

async function deleteCategory(db, recordAuditEvent, publishDomainEvent, categoryId, actorNombre) {
  assertPositiveInteger(categoryId, 'La categoria es invalida');

  return db.withTransaction(async ({ client, repository }) => {
    const blockingProducts = await repository.listActiveProductsByCategory(categoryId);

    if (blockingProducts.length > 0) {
      throw new DomainError(
        409,
        `No se puede eliminar la categoria porque tiene productos activos: ${blockingProducts.map((row) => row.titulo).join(', ')}`,
      );
    }

    const result = await repository.deleteCategory(categoryId);
    if (result.rowCount === 0) {
      throw new DomainError(404, 'La categoria no existe');
    }

    await recordAuditEvent(client, {
      agregado: 'categorias',
      agregadoId: categoryId,
      evento: 'categoria_eliminada',
      actorTipo: 'encargado',
      actorReferencia: actorNombre ?? 'encargado',
      payload: {},
    });

    await publishMesaPublicRefreshAll(client, publishDomainEvent, 'categoria_eliminada');

    return {
      id: categoryId,
      deleted: true,
    };
  });
}

async function listProducts(db) {
  return db.withConnection(async ({ repository }) => {
    const rows = await repository.listProducts();
    return rows.map(mapProduct);
  });
}

async function createProduct(db, recordAuditEvent, publishDomainEvent, payload, actorNombre) {
  const subcategoriaId = toNumber(payload.subcategoriaId);
  const titulo = normalizeText(payload.titulo);
  const descripcion = normalizeCatalogText(payload.descripcion);
  const precioArsCentavos = toNumber(payload.precioArsCentavos);
  const imagenNombreArchivo = normalizeOptionalText(payload.imagenNombreArchivo);

  assertPositiveInteger(subcategoriaId, 'La subcategoria del producto es obligatoria');
  if (!titulo) {
    throw new DomainError(400, 'El titulo del producto es obligatorio');
  }
  if (!descripcion) {
    throw new DomainError(400, 'La descripcion del producto es obligatoria');
  }
  assertPositiveInteger(precioArsCentavos, 'El precio del producto debe ser un entero positivo');

  return db.withTransaction(async ({ client, repository }) => {
    const subcategory = await repository.getSubcategoryById(subcategoriaId);
    if (!subcategory) {
      throw new DomainError(404, 'La subcategoria elegida no existe');
    }

    const created = await repository.createProduct(
      subcategoriaId,
      titulo,
      descripcion,
      precioArsCentavos,
      imagenNombreArchivo,
    );

    await recordAuditEvent(client, {
      agregado: 'productos',
      agregadoId: created.id,
      evento: 'producto_creado',
      actorTipo: 'encargado',
      actorReferencia: actorNombre ?? 'encargado',
      payload: {
        subcategoriaId,
        subcategoriaTitulo: subcategory.titulo,
        categoriaId: Number(subcategory.categoria_id),
        categoriaTitulo: subcategory.categoria_titulo,
        titulo,
        precioArsCentavos,
        imagenNombreArchivo,
      },
    });

    await publishMesaPublicRefreshAll(client, publishDomainEvent, 'producto_creado');

    return mapProduct({
      ...created,
      subcategoria_titulo: subcategory.titulo,
      categoria_id: subcategory.categoria_id,
      categoria_titulo: subcategory.categoria_titulo,
    });
  });
}

async function updateProduct(db, recordAuditEvent, publishDomainEvent, productId, payload, actorNombre) {
  assertPositiveInteger(productId, 'El producto es invalido');

  return db.withTransaction(async ({ client, repository }) => {
    const existing = await repository.getProductByIdForUpdate(productId);
    if (!existing) {
      throw new DomainError(404, 'El producto no existe');
    }

    const subcategoriaId = payload.subcategoriaId !== undefined
      ? toNumber(payload.subcategoriaId)
      : Number(existing.subcategoria_id);
    const titulo = normalizeText(payload.titulo ?? existing.titulo);
    const descripcion = normalizeCatalogText(payload.descripcion ?? existing.descripcion);
    const precioArsCentavos = payload.precioArsCentavos !== undefined
      ? toNumber(payload.precioArsCentavos)
      : Number(existing.precio_ars_centavos);
    const imagenNombreArchivo = payload.imagenNombreArchivo !== undefined
      ? normalizeOptionalText(payload.imagenNombreArchivo)
      : existing.imagen_nombre_archivo;
    const activo = payload.activo !== undefined ? Boolean(payload.activo) : existing.activo;

    assertPositiveInteger(subcategoriaId, 'La subcategoria del producto es obligatoria');
    if (!titulo) {
      throw new DomainError(400, 'El titulo del producto es obligatorio');
    }
    if (!descripcion) {
      throw new DomainError(400, 'La descripcion del producto es obligatoria');
    }
    assertPositiveInteger(precioArsCentavos, 'El precio del producto debe ser un entero positivo');

    const subcategory = await repository.getSubcategoryById(subcategoriaId);
    if (!subcategory) {
      throw new DomainError(404, 'La subcategoria elegida no existe');
    }

    const updated = await repository.updateProduct(
      productId,
      subcategoriaId,
      titulo,
      descripcion,
      precioArsCentavos,
      imagenNombreArchivo,
      activo,
    );

    await recordAuditEvent(client, {
      agregado: 'productos',
      agregadoId: productId,
      evento: activo ? 'producto_actualizado' : 'producto_desactivado',
      actorTipo: 'encargado',
      actorReferencia: actorNombre ?? 'encargado',
      payload: {
        subcategoriaId,
        subcategoriaTitulo: subcategory.titulo,
        categoriaId: Number(subcategory.categoria_id),
        categoriaTitulo: subcategory.categoria_titulo,
        titulo,
        precioArsCentavos,
        imagenNombreArchivo,
        activo,
      },
    });

    await publishMesaPublicRefreshAll(
      client,
      publishDomainEvent,
      activo ? 'producto_actualizado' : 'producto_desactivado',
    );

    return mapProduct({
      ...updated,
      subcategoria_titulo: subcategory.titulo,
      categoria_id: subcategory.categoria_id,
      categoria_titulo: subcategory.categoria_titulo,
    });
  });
}

async function disableProduct(db, recordAuditEvent, publishDomainEvent, productId, actorNombre) {
  assertPositiveInteger(productId, 'El producto es invalido');
  return updateProduct(db, recordAuditEvent, publishDomainEvent, productId, { activo: false }, actorNombre);
}

export function createCatalogAdminService(pool, recordAuditEvent, publishDomainEvent) {
  const db = createCatalogAdminDbAdapter(pool);

  return {
    listCategories: () => listCategories(db),
    listSubcategories: () => listSubcategories(db),
    createCategory: (payload, actorNombre) => createCategory(db, recordAuditEvent, publishDomainEvent, payload, actorNombre),
    updateCategory: (categoryId, payload, actorNombre) => updateCategory(db, recordAuditEvent, publishDomainEvent, categoryId, payload, actorNombre),
    deleteCategory: (categoryId, actorNombre) => deleteCategory(db, recordAuditEvent, publishDomainEvent, categoryId, actorNombre),
    listProducts: () => listProducts(db),
    createProduct: (payload, actorNombre) => createProduct(db, recordAuditEvent, publishDomainEvent, payload, actorNombre),
    updateProduct: (productId, payload, actorNombre) => updateProduct(db, recordAuditEvent, publishDomainEvent, productId, payload, actorNombre),
    disableProduct: (productId, actorNombre) => disableProduct(db, recordAuditEvent, publishDomainEvent, productId, actorNombre),
  };
}
