export function buildContractsSnapshot(config) {
  return {
    service: 'domain',
    responsibilities: [
      'sesiones-mesa',
      'carrito-compartido',
      'crud-categorias',
      'crud-productos',
      'abm-mesas',
      'dashboard',
      'eventos-mqtt',
      'eventos-sse',
    ],
    httpContracts: {
      internalReadModels: [
        '/internal/bootstrap',
        '/internal/catalog/contracts',
        '/internal/dashboard/contracts',
      ],
      internalCommandsPlanned: [
        'POST /internal/mesas/:mesaNumero/sesiones',
        'POST /internal/mesas/:mesaNumero/pedido/items',
        'POST /internal/mesas/:mesaNumero/pedido/confirmacion',
        'POST /internal/mesas/:mesaNumero/cierre',
        'POST /internal/consultas',
        'POST /internal/llamados-mozo',
      ],
    },
    mqttContracts: {
      baseTopic: config.mqttBaseTopic,
      topics: {
        androidInboundLoginRequest: `${config.mqttBaseTopic}/android/in/auth/login/request`,
        androidInboundHistoryRequest: `${config.mqttBaseTopic}/android/in/history/request`,
        androidInboundCloseWebSessionRequest: `${config.mqttBaseTopic}/android/in/system/web-session/close/request`,
        androidOutboundLoginResponse: `${config.mqttBaseTopic}/android/out/{deviceId}/auth/login/response`,
        androidOutboundCurrentDashboardMetrics: `${config.mqttBaseTopic}/android/out/{deviceId}/current/dashboard/metrics`,
        androidOutboundCurrentDashboardRevenue: `${config.mqttBaseTopic}/android/out/{deviceId}/current/dashboard/revenue`,
        androidOutboundCurrentQueues: `${config.mqttBaseTopic}/android/out/{deviceId}/current/queue/{statusBucket}/{queueType}`,
        androidOutboundHistoryFragments: `${config.mqttBaseTopic}/android/out/{deviceId}/history/{requestId}/#`,
        androidOutboundSystemEvents: `${config.mqttBaseTopic}/android/out/{deviceId}/system/#`,
      },
      payloads: {
        loginRequest: ['requestId', 'deviceId', 'username', 'password'],
        loginResponse: ['requestId', 'accepted', 'reason', 'deviceId'],
        currentDashboardMetrics: ['generatedAt', 'scope', 'fromUtc', 'toUtc', 'metrics'],
        currentDashboardRevenue: ['generatedAt', 'scope', 'fromUtc', 'toUtc', 'items'],
        currentQueueFragment: ['generatedAt', 'scope', 'fromUtc', 'toUtc', 'status', 'queueType', 'items'],
        historyRequest: ['requestId', 'deviceId', 'fromUtc', 'toUtc'],
        historyFragment: ['requestId', 'generatedAt', 'scope', 'fromUtc', 'toUtc'],
        systemEvent: ['type', 'deviceId', 'generatedAt', 'reason'],
      },
    },
  };
}
