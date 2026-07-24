export async function healthRoute(app, config, pool) {
  app.get('/health', async () => {
    const dependencies = {
      postgres: {
        status: 'unknown',
        detail: 'sin verificar',
      },
    };

    try {
      await pool.query('SELECT 1');
      dependencies.postgres = {
        status: 'ok',
        detail: 'SELECT 1 exitoso',
      };
    } catch (error) {
      dependencies.postgres = {
        status: 'error',
        detail: error.message,
      };
    }

    return {
      service: 'domain',
      status: dependencies.postgres.status === 'ok' ? 'ok' : 'degraded',
      timezone: config.businessTimezone,
      jornadaStartTime: config.jornadaStartTime,
      dependencies,
    };
  });
}
