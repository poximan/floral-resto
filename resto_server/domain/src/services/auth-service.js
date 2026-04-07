import crypto from 'node:crypto';
import { DomainError } from './domain-error.js';

const ROLE_WAITER = 'mozo';
const ROLE_MANAGER = 'encargado';
const MANAGER_IDLE_WINDOW_MS = 20 * 60 * 1000;

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

function buildSessionPayload(row) {
  return {
    id: Number(row.id),
    role: row.rol,
    actorNombre: row.actor_nombre,
    sessionToken: row.session_token,
    lastRelevantEventAt: row.ultimo_evento_relevante_en,
    createdAt: row.created_at,
  };
}

function createSessionToken() {
  return crypto.randomBytes(24).toString('hex');
}

async function getSessionByRole(client, role) {
  const result = await client.query(
    `
      SELECT id, rol, actor_nombre, session_token, ultimo_evento_relevante_en, created_at
      FROM roles_web_sessions
      WHERE rol = $1
      LIMIT 1
    `,
    [role],
  );

  return result.rows[0] ?? null;
}

async function getSessionByToken(client, sessionToken) {
  const result = await client.query(
    `
      SELECT id, rol, actor_nombre, session_token, ultimo_evento_relevante_en, created_at
      FROM roles_web_sessions
      WHERE session_token = $1
      LIMIT 1
    `,
    [sessionToken],
  );

  return result.rows[0] ?? null;
}

async function deleteSessionByRole(client, role) {
  await client.query(
    `
      DELETE FROM roles_web_sessions
      WHERE rol = $1
    `,
    [role],
  );
}

async function deleteSessionByToken(client, sessionToken) {
  await client.query(
    `
      DELETE FROM roles_web_sessions
      WHERE session_token = $1
    `,
    [sessionToken],
  );
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

async function login(pool, config, recordAuditEvent, publishDomainEvent, payload) {
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

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existingSession = await getSessionByRole(client, role);
    if (existingSession) {
      if (role === ROLE_MANAGER) {
        const ageMs = getSessionAgeMs(existingSession.ultimo_evento_relevante_en);

        if (ageMs < MANAGER_IDLE_WINDOW_MS) {
          throw buildManagerActiveSessionError();
        }

        await recordAuditEvent(client, {
          agregado: 'roles_web_sessions',
          agregadoId: role,
          evento: 'login_reemplazado_por_inactividad',
          actorTipo: role,
          actorReferencia: existingSession.actor_nombre,
          payload: {
            sessionTokenAnterior: existingSession.session_token,
            ultimoEventoRelevanteEn: existingSession.ultimo_evento_relevante_en,
          },
        });
        await deleteSessionByRole(client, role);
        await publishManagerWebSessionEvent(
          client,
          publishDomainEvent,
          'closed',
          'reemplazada_por_inactividad',
          existingSession.actor_nombre,
        );
      } else {
        await recordAuditEvent(client, {
          agregado: 'roles_web_sessions',
          agregadoId: role,
          evento: 'login_reemplazado_por_nuevo_login',
          actorTipo: role,
          actorReferencia: existingSession.actor_nombre,
          payload: {
            sessionTokenAnterior: existingSession.session_token,
            reemplazadaPor: roleConfig.actorNombre,
          },
        });
        await deleteSessionByRole(client, role);
        await publishWaiterWebSessionEvent(
          client,
          publishDomainEvent,
          'closed',
          'reemplazada_por_nuevo_login',
          existingSession.actor_nombre,
        );
      }
    }

    const sessionToken = createSessionToken();
    const result = await client.query(
      `
        INSERT INTO roles_web_sessions (
          rol,
          actor_nombre,
          session_token,
          ultimo_evento_relevante_en
        )
        VALUES ($1, $2, $3, NOW())
        RETURNING id, rol, actor_nombre, session_token, ultimo_evento_relevante_en, created_at
      `,
      [role, roleConfig.actorNombre, sessionToken],
    );

    await recordAuditEvent(client, {
      agregado: 'roles_web_sessions',
      agregadoId: role,
      evento: 'login_creado',
      actorTipo: role,
      actorReferencia: roleConfig.actorNombre,
      payload: {
        sessionToken,
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

    await client.query('COMMIT');
    return buildSessionPayload(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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

async function validateSession(pool, recordAuditEvent, publishDomainEvent, sessionToken, options = {}) {
  if (!sessionToken) {
    throw new DomainError(401, 'Falta la sesion interna');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const sessionRow = await getSessionByToken(client, sessionToken);
    if (!sessionRow) {
      throw new DomainError(401, 'La sesion interna no existe o ya fue cerrada');
    }

    const session = buildSessionPayload(sessionRow);
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
            sessionToken,
            ultimoEventoRelevanteEn: session.lastRelevantEventAt,
          },
        });
        await deleteSessionByToken(client, sessionToken);
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
      const touchResult = await client.query(
        `
          UPDATE roles_web_sessions
          SET ultimo_evento_relevante_en = NOW()
          WHERE session_token = $1
          RETURNING id, rol, actor_nombre, session_token, ultimo_evento_relevante_en, created_at
        `,
        [sessionToken],
      );

      await client.query('COMMIT');
      return buildSessionPayload(touchResult.rows[0]);
    }

    await client.query('COMMIT');
    return session;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function touchRelevantEvent(pool, sessionToken) {
  if (!sessionToken) {
    throw new DomainError(401, 'Falta la sesion interna');
  }

  const result = await pool.query(
    `
      UPDATE roles_web_sessions
      SET ultimo_evento_relevante_en = NOW()
      WHERE session_token = $1
      RETURNING id, rol, actor_nombre, session_token, ultimo_evento_relevante_en, created_at
    `,
    [sessionToken],
  );

  if (result.rowCount === 0) {
    throw new DomainError(401, 'La sesion interna no existe o ya fue cerrada');
  }

  return buildSessionPayload(result.rows[0]);
}

async function logout(pool, recordAuditEvent, publishDomainEvent, sessionToken) {
  if (!sessionToken) {
    throw new DomainError(401, 'Falta la sesion interna');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const sessionRow = await getSessionByToken(client, sessionToken);
    if (!sessionRow) {
      throw new DomainError(401, 'La sesion interna no existe o ya fue cerrada');
    }

    await recordAuditEvent(client, {
      agregado: 'roles_web_sessions',
      agregadoId: sessionRow.rol,
      evento: 'logout_manual',
      actorTipo: sessionRow.rol,
      actorReferencia: sessionRow.actor_nombre,
      payload: {
        sessionToken,
      },
    });

    await deleteSessionByToken(client, sessionToken);

    if (sessionRow.rol === ROLE_MANAGER) {
      await publishManagerWebSessionEvent(
        client,
        publishDomainEvent,
        'closed',
        'logout_manual',
        sessionRow.actor_nombre,
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return {
    loggedOut: true,
  };
}

async function forceCloseManagerWebSession(pool, recordAuditEvent, publishDomainEvent) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existingSession = await getSessionByRole(client, ROLE_MANAGER);

    await client.query(
      `
        DELETE FROM roles_web_sessions
        WHERE rol = $1
      `,
      [ROLE_MANAGER],
    );

    if (existingSession) {
      await recordAuditEvent(client, {
        agregado: 'roles_web_sessions',
        agregadoId: ROLE_MANAGER,
        evento: 'sesion_forzada_desde_android',
        actorTipo: 'encargado_mobile',
        actorReferencia: 'android',
        payload: {
          sessionToken: existingSession.session_token,
          objetivoActorNombre: existingSession.actor_nombre,
        },
      });

      await publishManagerWebSessionEvent(
        client,
        publishDomainEvent,
        'closed',
        'forzada_desde_android',
        existingSession.actor_nombre,
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return {
    role: ROLE_MANAGER,
    closed: true,
  };
}

export function createAuthService(pool, config, recordAuditEvent, publishDomainEvent) {
  return {
    login: (payload) => login(pool, config, recordAuditEvent, publishDomainEvent, payload),
    validateManagerCredentials: (payload) => validateManagerCredentials(config, payload),
    validateSession: (sessionToken, options) => validateSession(pool, recordAuditEvent, publishDomainEvent, sessionToken, options),
    touchRelevantEvent: (sessionToken) => touchRelevantEvent(pool, sessionToken),
    logout: (sessionToken) => logout(pool, recordAuditEvent, publishDomainEvent, sessionToken),
    forceCloseManagerWebSession: () => forceCloseManagerWebSession(pool, recordAuditEvent, publishDomainEvent),
  };
}
