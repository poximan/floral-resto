import pg from 'pg';

export function createPool(config) {
  const pool = new pg.Pool({
    host: config.postgres.host,
    port: config.postgres.port,
    database: config.postgres.database,
    user: config.postgres.user,
    password: config.postgres.password,
    max: 10,
    idleTimeoutMillis: 30000,
  });

  return pool;
}
