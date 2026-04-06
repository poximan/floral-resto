function extractBearerToken(request) {
  const authorization = request.headers.authorization ?? '';

  if (!authorization.startsWith('Bearer ')) {
    return null;
  }

  return authorization.slice('Bearer '.length).trim();
}

export async function authRoutes(app, authService) {
  app.post('/internal/auth/login', async (request, reply) => {
    const payload = await authService.login({
      role: request.body?.role ?? null,
      username: request.body?.username ?? null,
      password: request.body?.password ?? null,
    });

    reply.code(201);
    return payload;
  });

  app.get('/internal/auth/session', async (request) => {
    const sessionToken = extractBearerToken(request);

    return authService.validateSession(sessionToken, {
      allowedRoles: ['mozo', 'encargado'],
      touchActivity: false,
    });
  });

  app.post('/internal/auth/logout', async (request) => {
    const sessionToken = extractBearerToken(request);
    return authService.logout(sessionToken);
  });
}

export function createRoleGuard(authService, allowedRoles, options = {}) {
  return async function roleGuard(request) {
    const sessionToken = extractBearerToken(request);
    const session = await authService.validateSession(sessionToken, {
      allowedRoles,
      touchActivity: options.touchActivity ?? false,
    });

    request.authSession = session;
  };
}
