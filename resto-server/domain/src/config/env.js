const requiredEnv = [
  'DOMAIN_HOST',
  'DOMAIN_PORT',
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_DB',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_SCHEMA',
  'BUSINESS_TIMEZONE',
  'JORNADA_START_TIME',
  'MESA_CLIENT_DISCONNECT_GRACE_SECONDS',
  'MQTT_BASE_TOPIC',
  'WAITER_USERNAME',
  'WAITER_PASSWORD',
  'MANAGER_USERNAME',
  'MANAGER_PASSWORD',
];

export function loadEnv() {
  for (const key of requiredEnv) {
    if (!process.env[key]) {
      throw new Error(`Falta variable obligatoria ${key}`);
    }
  }

  const mesaClientDisconnectGraceSeconds = Number.parseInt(
    process.env.MESA_CLIENT_DISCONNECT_GRACE_SECONDS,
    10,
  );

  if (!Number.isInteger(mesaClientDisconnectGraceSeconds) || mesaClientDisconnectGraceSeconds <= 0) {
    throw new Error('MESA_CLIENT_DISCONNECT_GRACE_SECONDS debe ser un entero positivo');
  }

  return {
    domainHost: process.env.DOMAIN_HOST,
    domainPort: Number.parseInt(process.env.DOMAIN_PORT, 10),
    businessTimezone: process.env.BUSINESS_TIMEZONE,
    jornadaStartTime: process.env.JORNADA_START_TIME,
    mesaClientDisconnectGraceSeconds,
    mqttBaseTopic: process.env.MQTT_BASE_TOPIC,
    waiterUsername: process.env.WAITER_USERNAME,
    waiterPassword: process.env.WAITER_PASSWORD,
    managerUsername: process.env.MANAGER_USERNAME,
    managerPassword: process.env.MANAGER_PASSWORD,
    postgres: {
      host: process.env.POSTGRES_HOST,
      port: Number.parseInt(process.env.POSTGRES_PORT, 10),
      database: process.env.POSTGRES_DB,
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      schema: process.env.POSTGRES_SCHEMA,
    },
  };
}
