import { createRoleGuard } from './auth.js';

function parsePositiveId(value, message) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(message);
  }

  return parsed;
}

export async function adminRoutes(app, adminService, authService) {
  const encargadoGuard = createRoleGuard(authService, ['encargado'], { touchActivity: true });
  const mozoGuard = createRoleGuard(authService, ['mozo']);

  app.get('/internal/admin/dashboard', { preHandler: encargadoGuard }, async () => adminService.getDashboard());

  app.get('/internal/admin/config', { preHandler: mozoGuard }, async () => adminService.getVisualConfig());

  app.put('/internal/admin/config', { preHandler: mozoGuard }, async (request) =>
    adminService.updateVisualConfig({
      visualUsdExchangeRate: request.body?.visualUsdExchangeRate,
    }, request.authSession.actorNombre));

  app.get('/internal/admin/categorias', { preHandler: encargadoGuard }, async () => adminService.listCategories());

  app.post('/internal/admin/categorias', { preHandler: encargadoGuard }, async (request, reply) => {
    const payload = await adminService.createCategory(request.body ?? {}, request.authSession.actorNombre);
    reply.code(201);
    return payload;
  });

  app.put('/internal/admin/categorias/:categoriaId', { preHandler: encargadoGuard }, async (request) =>
    adminService.updateCategory(
      parsePositiveId(request.params.categoriaId, 'La categoria es invalida'),
      request.body ?? {},
      request.authSession.actorNombre,
    ));

  app.delete('/internal/admin/categorias/:categoriaId', { preHandler: encargadoGuard }, async (request) =>
    adminService.deleteCategory(
      parsePositiveId(request.params.categoriaId, 'La categoria es invalida'),
      request.authSession.actorNombre,
    ));

  app.get('/internal/admin/productos', { preHandler: encargadoGuard }, async () => adminService.listProducts());

  app.post('/internal/admin/productos', { preHandler: encargadoGuard }, async (request, reply) => {
    const payload = await adminService.createProduct(request.body ?? {}, request.authSession.actorNombre);
    reply.code(201);
    return payload;
  });

  app.put('/internal/admin/productos/:productoId', { preHandler: encargadoGuard }, async (request) =>
    adminService.updateProduct(
      parsePositiveId(request.params.productoId, 'El producto es invalido'),
      request.body ?? {},
      request.authSession.actorNombre,
    ));

  app.delete('/internal/admin/productos/:productoId', { preHandler: encargadoGuard }, async (request) =>
    adminService.disableProduct(
      parsePositiveId(request.params.productoId, 'El producto es invalido'),
      request.authSession.actorNombre,
    ));

  app.get('/internal/admin/mesas', { preHandler: mozoGuard }, async () => adminService.listMesas());

  app.post('/internal/admin/mesas', { preHandler: mozoGuard }, async (request, reply) => {
    const payload = await adminService.createMesa(request.body ?? {}, request.authSession.actorNombre);
    reply.code(201);
    return payload;
  });

  app.put('/internal/admin/mesas/:mesaId', { preHandler: mozoGuard }, async (request) =>
    adminService.updateMesa(
      parsePositiveId(request.params.mesaId, 'La mesa es invalida'),
      request.body ?? {},
      request.authSession.actorNombre,
    ));

  app.post('/internal/admin/mesas/:mesaNumero/close', { preHandler: mozoGuard }, async (request) => {
    const payload = await adminService.closeMesa(
      parsePositiveId(request.params.mesaNumero, 'La mesa es invalida'),
      request.authSession.actorNombre,
    );

    await authService.touchRelevantEvent(request.authSession.sessionToken);
    return payload;
  });
}
