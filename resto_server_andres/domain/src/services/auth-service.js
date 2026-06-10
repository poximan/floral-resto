import crypto from 'node:crypto';
import { createAuthSessionDbAdapter } from '../db/adapters/auth-session-db-adapter.js';
import { DomainError } from './domain-error.js';

const ROLE_WAITER = 'mozo';
const ROLE_MANAGER = 'encargado';
const MANAGER_IDLE_WINDOW_MS = 20 * 60 * 1000;

function hashSessionToken(sessionToken) {
  return crypto.createHash('sha256').update(sessionToken).digest('hex');
}

function normalizeRole(role) {
  const normalized = role?.trim().toLowerCase() ?? '';

  if (![ROLE_WAITER, ROLE_MANAGER].includes(normalized)) {
    throw new DomainError(400, 'El rol solicitado es invalido');
  }

  return normalized;
}

function getRoleConfig(config, role) {
  if (role === ROLE_WAITER) {
    return {
      username: config.waiterUsername,
      password: config.waiterPassword,
      actorNombre: config.waiterUsername,
    };
  }

  return {
    username: config.managerUsername,
    password: config.managerPassword,
    actorNombre: config.managerUsername,
  };
}

function buildSessionPayload(row, sessionToken = null) {
  return {
    id: Number(row.id),
    role: row.rol,
    actorNombre: row.actor_nombre,
    sessionToken,
    lastRelevantEventAt: row.ultimo_evento_relevante_en,
    createdAt: row.created_at,
  };
}

function createSessionToken() {
  return crypto.randomBytes(24).toString('hex');
}

async function getSessionByRole(repository, role) {
  const row = await repository.getSessionByRole(role);
  return row ? buildSessionPayload(row) : null;
}

async function getSessionByToken(repository, sessionToken) {
  const sessionTokenHash = hashSessionToken(sessionToken);
  const row = await repository.getSessionByTokenHash(sessionTokenHash);
  return row ? buildSessionPayload(row, sessionToken) : null;
}

function getSessionAgeMs(lastRelevantEventAt) {
  return Date.now() - new Date(lastRelevantEventAt).getTime();
}

function assertCredentials(expected, provided, role) {
  if (expected.username !== provided.username || expected.password !== provided.password) {
    throw new DomainError(401, `Las credenciales del rol ${role} son invalidas`);
  }
}

function buildManagerActiveSessionError() {
  return new DomainError(
    409,
    'Ya hay un encargado web activo. El ingreso solo se habilita si no hubo actividad web durante los ultimos 20 minutos.',
  );
}

async function publishWaiterWebSessionEvent(client, publishDomainEvent, event, reason, actorNombre) {
  if (!publishDomainEvent) {
    return;
  }

  await publishDomainEvent(client, {
    type: 'waiter_web_session',
    event,
    reason,
    actorNombre: actorNombre ?? null,
  });
}

async function publishManagerWebSessionEvent(client, publishDomainEvent, event, reason, actorNombre) {
  if (!publishDomainEvent) {
    return;
  }

  await publishDomainEvent(client, {
    type: 'manager_web_session',
    event,
    reason,
    actorNombre: actorNombre ?? null,
  });
}

async function login(db, config, recordAuditEvent, publishDomainEvent, payload) {
  const role = normalizeRole(payload.role);
  const roleConfig = getRoleConfig(config, role);

  assertCredentials(
    roleConfig,
    {
      username: payload.username?.trim() ?? '',
      password: payload.password ?? '',
    },
    role,
  );

  return db.withTransaction(async ({ client, repository }) => {
    const existingSession = await getSessionByRole(repository, role);
    if (existingSession) {
      if (role === ROLE_MANAGER) {
        const ageMs = getSessionAgeMs(existingSession.lastRelevantEventAt);

        if (ageMs < MANAGER_IDLE_WINDOW_MS) {
          throw buildManagerActiveSessionError();
        }

        await recordAuditEvent(client, {
          agregado: 'roles_web_sessions',
          agregadoId: role,
          evento: 'login_reemplazado_por_inactividad',
          actorTipo: role,
          actorReferencia: existingSession.actorNombre,
          payload: {
            sessionIdAnterior: existingSession.id,
            ultimoEventoRelevanteEn: existingSession.lastRelevantEventAt,
          },
        });
        await repository.deleteSessionByRole(role);
        await publishManagerWebSessionEvent(
          client,
          publishDomainEvent,
          'closed',
          'reemplazada_por_inactividad',
          existingSession.actorNombre,
        );
      } else {
        await recordAuditEvent(client, {
          agregado: 'roles_web_sessions',
          agregadoId: role,
          evento: 'login_reemplazado_por_nuevo_login',
          actorTipo: role,
          actorReferencia: existingSession.actorNombre,
          payload: {
            sessionIdAnterior: existingSession.id,
            reemplazadaPor: roleConfig.actorNombre,
          },
        });
        await repository.deleteSessionByRole(role);
        await publishWaiterWebSessionEvent(
          client,
          publishDomainEvent,
          'closed',
          'reemplazada_por_nuevo_login',
          existingSession.actorNombre,
        );
      }
    }

    const sessionToken = createSessionToken();
    const sessionTokenHash = hashSessionToken(sessionToken);
    const row = await repository.createSession(role, roleConfig.actorNombre, sessionTokenHash);

    await recordAuditEvent(client, {
      agregado: 'roles_web_sessions',
      agregadoId: role,
      evento: 'login_creado',
      actorTipo: role,
      actorReferencia: roleConfig.actorNombre,
      payload: {
        sessionId: Number(row.id),
      },
    });

    if (role === ROLE_MANAGER) {
      await publishManagerWebSessionEvent(
        client,
        publishDomainEvent,
        'opened',
        'login_creado',
        roleConfig.actorNombre,
      );
    }

    return buildSessionPayload(row, sessionToken);
  });
}

async function validateManagerCredentials(config, payload) {
  assertCredentials(
    getRoleConfig(config, ROLE_MANAGER),
    {
      username: payload.username?.trim() ?? '',
      password: payload.password ?? '',
    },
    ROLE_MANAGER,
  );

  return {
    role: ROLE_MANAGER,
    actorNombre: config.managerUsername,
  };
}

async function validateSession(db, recordAuditEvent, publishDomainEvent, sessionToken, options = {}) {
  if (!sessionToken) {
    throw new DomainError(401, 'Falta la sesion interna');
  }

  return db.withTransaction(async ({ client, repository }) => {
    const session = await getSessionByToken(repository, sessionToken);
    if (!session) {
      throw new DomainError(401, 'La sesion interna no existe o ya fue cerrada');
    }
    const allowedRoles = options.allowedRoles ?? null;

    if (Array.isArray(allowedRoles) && !allowedRoles.includes(session.role)) {
      throw new DomainError(403, 'La sesion interna no tiene permisos para esta operacion');
    }

    if (session.role === ROLE_MANAGER) {
      const ageMs = getSessionAgeMs(session.lastRelevantEventAt);

      if (ageMs >= MANAGER_IDLE_WINDOW_MS) {
        await recordAuditEvent(client, {
          agregado: 'roles_web_sessions',
          agregadoId: session.role,
          evento: 'sesion_expirada_por_inactividad',
          actorTipo: session.role,
          actorReferencia: session.actorNombre,
          payload: {
            sessionId: session.id,
            ultimoEventoRelevanteEn: session.lastRelevantEventAt,
          },
        });
        await repository.deleteSessionByTokenHash(hashSessionToken(sessionToken));
        await publishManagerWebSessionEvent(
          client,
          publishDomainEvent,
          'closed',
          'expirada_por_inactividad',
          session.actorNombre,
        );
        throw new DomainError(401, 'La sesion web del encargado expiro por inactividad');
      }
    }

    if (options.touchActivity === true) {
      const touchResult = await repository.touchSessionByTokenHash(hashSessionToken(sessionToken));
      return buildSessionPayload(touchResult.rows[0], sessionToken);
    }

    return session;
  });
}

async function touchRelevantEvent(db, sessionToken) {
  if (!sessionToken) {
    throw new DomainError(401, 'Falta la sesion interna');
  }

  return db.withConnection(async ({ repository }) => {
    const result = await repository.touchSessionByTokenHash(hashSessionToken(sessionToken));

    if (result.rowCount === 0) {
      throw new DomainError(401, 'La sesion interna no existe o ya fue cerrada');
    }

    return buildSessionPayload(result.rows[0], sessionToken);
  });
}

async function logout(db, recordAuditEvent, publishDomainEvent, sessionToken) {
  if (!sessionToken) {
    throw new DomainError(401, 'Falta la sesion interna');
  }

  await db.withTransaction(async ({ client, repository }) => {
    const session = await getSessionByToken(repository, sessionToken);
    if (!session) {
      throw new DomainError(401, 'La sesion interna no existe o ya fue cerrada');
    }

    await recordAuditEvent(client, {
      agregado: 'roles_web_sessions',
      agregadoId: session.role,
      evento: 'logout_manual',
      actorTipo: session.role,
      actorReferencia: session.actorNombre,
      payload: {
        sessionId: session.id,
      },
    });

    await repository.deleteSessionByTokenHash(hashSessionToken(sessionToken));

    if (session.role === ROLE_MANAGER) {
      await publishManagerWebSessionEvent(
        client,
        publishDomainEvent,
        'closed',
        'logout_manual',
        session.actorNombre,
      );
    }
  });

  return {
    loggedOut: true,
  };
}

async function forceCloseManagerWebSession(db, recordAuditEvent, publishDomainEvent) {
  await db.withTransaction(async ({ client, repository }) => {
    const existingSession = await getSessionByRole(repository, ROLE_MANAGER);

    await repository.deleteSessionByRole(ROLE_MANAGER);

    if (existingSession) {
      await recordAuditEvent(client, {
        agregado: 'roles_web_sessions',
        agregadoId: ROLE_MANAGER,
        evento: 'sesion_forzada_desde_android',
        actorTipo: 'encargado_mobile',
        actorReferencia: 'android',
        payload: {
          sessionId: existingSession.id,
          objetivoActorNombre: existingSession.actorNombre,
        },
      });

      await publishManagerWebSessionEvent(
        client,
        publishDomainEvent,
        'closed',
        'forzada_desde_android',
        existingSession.actorNombre,
      );
    }
  });

  return {
    role: ROLE_MANAGER,
    closed: true,
  };
}

export function createAuthService(pool, config, recordAuditEvent, publishDomainEvent) {
  const db = createAuthSessionDbAdapter(pool);

  return {
    login: (payload) => login(db, config, recordAuditEvent, publishDomainEvent, payload),
    validateManagerCredentials: (payload) => validateManagerCredentials(config, payload),
    validateSession: (sessionToken, options) =>
      validateSession(db, recordAuditEvent, publishDomainEvent, sessionToken, options),
    touchRelevantEvent: (sessionToken) => touchRelevantEvent(db, sessionToken),
    logout: (sessionToken) => logout(db, recordAuditEvent, publishDomainEvent, sessionToken),
    forceCloseManagerWebSession: () => forceCloseManagerWebSession(db, recordAuditEvent, publishDomainEvent),
  };
}
