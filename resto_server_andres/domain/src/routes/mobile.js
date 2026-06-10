export async function mobileRoutes(app, adminService, authService) {
  app.post('/internal/mobile/auth/manager-login', async (request) =>
    authService.validateManagerCredentials({
      username: request.body?.username ?? null,
      password: request.body?.password ?? null,
    }));

  app.get('/internal/mobile/snapshot', async () =>
    adminService.getMobileSnapshot());

  app.get('/internal/mobile/current/dashboard/metrics', async () =>
    adminService.getMobileCurrentDashboardMetrics());

  app.get('/internal/mobile/current/dashboard/revenue', async () =>
    adminService.getMobileCurrentDashboardRevenue());

  app.get('/internal/mobile/current/queues/:status/:queueType', async (request) =>
    adminService.getMobileCurrentQueueFragment(
      request.params?.status ?? null,
      request.params?.queueType ?? null,
    ));

  app.post('/internal/mobile/history', async (request) =>
    adminService.getHistoryDataset({
      fromUtc: request.body?.fromUtc ?? null,
      toUtc: request.body?.toUtc ?? null,
    }));

  app.post('/internal/mobile/manager-web-session/close', async () =>
    authService.forceCloseManagerWebSession());
}
