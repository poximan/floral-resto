export async function healthRoute(app, config) {
  app.get('/health', async () => ({
    service: 'domain',
    status: 'ok',
    timezone: config.businessTimezone,
    jornadaStartTime: config.jornadaStartTime,
  }));
}
