package atendedor.resto.resto_app.data

import android.content.Context
import androidx.room.Room
import atendedor.resto.resto_app.R
import atendedor.resto.resto_app.config.MqttConfig
import atendedor.resto.resto_app.data.local.CachedDatasetEntity
import atendedor.resto.resto_app.data.local.DashboardMetricEntity
import atendedor.resto.resto_app.data.local.MobileCacheDatabase
import atendedor.resto.resto_app.data.local.QueueItemEntity
import atendedor.resto.resto_app.data.local.RevenueByTableEntity
import atendedor.resto.resto_app.data.mobile.DashboardMetricsFragmentModel
import atendedor.resto.resto_app.data.mobile.DatasetRange
import atendedor.resto.resto_app.data.mobile.MobileJsonParser
import atendedor.resto.resto_app.data.mobile.QueueFragmentModel
import atendedor.resto.resto_app.data.mobile.RevenueFragmentModel
import atendedor.resto.resto_app.mqtt.AndroidCloseWebSessionRequest
import atendedor.resto.resto_app.mqtt.AndroidHistoryRequest
import atendedor.resto.resto_app.mqtt.AndroidLoginRequest
import atendedor.resto.resto_app.mqtt.ConnectionChanged
import atendedor.resto.resto_app.mqtt.ErrorRaised
import atendedor.resto.resto_app.mqtt.ManagerMqttClient
import atendedor.resto.resto_app.mqtt.MessageReceived
import atendedor.resto.resto_app.mqtt.MqttClientEvent
import atendedor.resto.resto_app.mqtt.MqttTopicsFactory
import atendedor.resto.resto_app.ui.DashboardMetricUi
import atendedor.resto.resto_app.ui.MainUiState
import atendedor.resto.resto_app.ui.QueueItemUi
import atendedor.resto.resto_app.ui.RevenueByTableUi
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject

private const val FRAGMENT_DASHBOARD_METRICS = "dashboard.metrics"
private const val FRAGMENT_DASHBOARD_REVENUE = "dashboard.revenue"
private const val FRAGMENT_HISTORY_QUEUE_PREFIX = "history.queue."
private const val FRAGMENT_CURRENT_QUEUE_PREFIX = "current.queue."

private val CURRENT_EXPECTED_FRAGMENTS = setOf(
    FRAGMENT_DASHBOARD_METRICS,
    FRAGMENT_DASHBOARD_REVENUE,
    "$FRAGMENT_CURRENT_QUEUE_PREFIX${queueFragmentKey("consultas", "pendiente")}",
    "$FRAGMENT_CURRENT_QUEUE_PREFIX${queueFragmentKey("consultas", "atendido")}",
    "$FRAGMENT_CURRENT_QUEUE_PREFIX${queueFragmentKey("pedidosCocina", "pendiente")}",
    "$FRAGMENT_CURRENT_QUEUE_PREFIX${queueFragmentKey("pedidosCocina", "atendido")}",
    "$FRAGMENT_CURRENT_QUEUE_PREFIX${queueFragmentKey("llamadosMozo", "pendiente")}",
    "$FRAGMENT_CURRENT_QUEUE_PREFIX${queueFragmentKey("llamadosMozo", "atendido")}",
)

class ManagerMobileRepository(
    private val context: Context,
    private val config: MqttConfig,
) {
    private val database = Room.databaseBuilder(
        context,
        MobileCacheDatabase::class.java,
        "resto_mobile_cache.db",
    ).fallbackToDestructiveMigration().build()
    private val dao = database.mobileCacheDao()
    private val topics = MqttTopicsFactory.fromConfig(config)
    private val mqttClient = ManagerMqttClient(config, topics)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val mutableUiState = MutableStateFlow(MainUiState())
    private val pendingHistoryRequests = mutableMapOf<String, String>()
    private val pendingHistoryScopes = mutableSetOf<String>()
    private var brokerOnline = false
    private var managerAuthenticated = false
    private var activeScopeKey: String? = null
    private var currentSyncScopeKey: String? = null

    val uiState: StateFlow<MainUiState> = mutableUiState.asStateFlow()

    init {
        scope.launch {
            mqttClient.events().collect { event ->
                try {
                    handleMqttEvent(event)
                } catch (_: Exception) {
                    emitState(errorMessage = context.getString(R.string.error_invalid_payload))
                }
            }
        }
    }

    fun start() {
        mqttClient.connect()
    }

    fun stop() {
        mqttClient.disconnect()
    }

    fun requestCurrentScope() {
        scope.launch {
            val currentDataset = dao.getLatestDatasetByKind("current")

            if (currentDataset != null) {
                loadScope(
                    currentDataset.scopeKey,
                    statusMessage = context.getString(R.string.status_current_from_cache),
                )
            }
        }
    }

    fun requestHistory(fromUtc: String, toUtc: String) {
        scope.launch {
            val cachedDataset = dao.getDatasetByRange(
                scopeKind = "history",
                fromUtc = fromUtc,
                toUtc = toUtc,
            )

            if (cachedDataset != null && cachedDataset.complete) {
                loadScope(
                    scopeKey = cachedDataset.scopeKey,
                    statusMessage = context.getString(R.string.status_history_from_cache),
                )
                return@launch
            }

            publishHistoryRequest(fromUtc, toUtc)
        }
    }

    fun closeManagerWebSession() {
        scope.launch {
            try {
                mqttClient.publish(
                    topics.closeWebSessionRequest,
                    JSONObject(
                        AndroidCloseWebSessionRequest(
                            requestId = UUID.randomUUID().toString(),
                            deviceId = config.deviceId,
                        ).toMap()
                    ).toString()
                )
                emitState(statusMessage = context.getString(R.string.status_close_web_request_sent))
            } catch (error: Exception) {
                emitState(errorMessage = resolveClientMessage(error.message))
            }
        }
    }

    private suspend fun handleMqttEvent(event: MqttClientEvent) {
        when (event) {
            is ConnectionChanged -> {
                brokerOnline = event.online

                if (!event.online) {
                    managerAuthenticated = false
                    currentSyncScopeKey = null
                    pendingHistoryRequests.clear()
                    pendingHistoryScopes.clear()
                }

                emitState(
                    brokerOnline = brokerOnline,
                    managerAuthenticated = managerAuthenticated,
                    syncInProgress = hasPendingSync(),
                    statusMessage = if (event.online) {
                        context.getString(R.string.status_broker_online_message)
                    } else {
                        context.getString(R.string.status_broker_offline_message)
                    },
                    errorMessage = null,
                )

                if (event.online) {
                    publishLoginRequest()
                }
            }

            is ErrorRaised -> {
                emitState(errorMessage = resolveClientMessage(event.message))
            }

            is MessageReceived -> {
                handleIncomingPayload(event.topic, event.payload)
            }
        }
    }

    private suspend fun handleIncomingPayload(topic: String, payload: String) {
        when {
            topics.isLoginResponseTopic(topic) -> handleLoginResponse(payload)
            topics.isCurrentDashboardMetricsTopic(topic) -> handleCurrentMetricsPayload(payload)
            topics.isCurrentDashboardRevenueTopic(topic) -> handleCurrentRevenuePayload(payload)
            topics.isCurrentQueueTopic(topic) -> handleCurrentQueuePayload(payload)
            topics.isHistoryTopic(topic) -> handleHistoryFragmentPayload(payload)
            topics.isSystemTopic(topic) -> handleAuxiliaryPayload(payload)
            else -> Unit
        }
    }

    private suspend fun handleLoginResponse(payload: String) {
        val accepted = MobileJsonParser.parseLoginAccepted(payload)
        if (!accepted) {
            managerAuthenticated = false
            currentSyncScopeKey = null
            emitState(
                managerAuthenticated = false,
                syncInProgress = hasPendingSync(),
                errorMessage = MobileJsonParser.parseInfoMessage(payload)
                    ?: context.getString(R.string.error_login_rejected),
            )
            return
        }

        managerAuthenticated = true
        currentSyncScopeKey = null

        val cachedCurrentDataset = dao.getLatestDatasetByKind("current")
        if (cachedCurrentDataset != null) {
            currentSyncScopeKey = cachedCurrentDataset.scopeKey
            dao.upsertDataset(
                cachedCurrentDataset.copy(
                    fragmentsReadyCsv = "",
                    complete = false,
                )
            )
            loadScope(
                cachedCurrentDataset.scopeKey,
                statusMessage = context.getString(R.string.status_current_from_cache_while_syncing),
            )
        }

        emitState(
            managerAuthenticated = true,
            syncInProgress = true,
            statusMessage = context.getString(R.string.status_mobile_authenticated_message),
            errorMessage = null,
        )
    }

    private suspend fun handleCurrentMetricsPayload(payload: String) {
        val fragment = MobileJsonParser.parseDashboardMetricsFragment(payload)
        val dataset = persistMetricsFragment(fragment)
        currentSyncScopeKey = fragment.range.scopeKey
        maybeRevealCurrentScope(dataset, fragment.range.scopeKey)
    }

    private suspend fun handleCurrentRevenuePayload(payload: String) {
        val fragment = MobileJsonParser.parseRevenueFragment(payload)
        val dataset = persistRevenueFragment(fragment)
        currentSyncScopeKey = fragment.range.scopeKey
        maybeRevealCurrentScope(dataset, fragment.range.scopeKey)
    }

    private suspend fun handleCurrentQueuePayload(payload: String) {
        val fragment = MobileJsonParser.parseQueueFragment(payload)
        val dataset = persistCurrentQueueFragment(fragment)
        currentSyncScopeKey = fragment.range.scopeKey
        maybeRevealCurrentScope(dataset, fragment.range.scopeKey)
    }

    private suspend fun maybeRevealCurrentScope(dataset: CachedDatasetEntity, scopeKey: String) {
        currentSyncScopeKey = if (dataset.complete) {
            null
        } else {
            scopeKey
        }

        if (activeScopeKey == null || activeScopeKey?.startsWith("current|") == true) {
            loadScope(
                scopeKey,
                statusMessage = if (dataset.complete) {
                    context.getString(R.string.status_snapshot_updated_message)
                } else {
                    context.getString(R.string.status_snapshot_partial_message)
                },
            )
        } else {
            emitState(statusMessage = context.getString(R.string.status_snapshot_kept_history_message))
        }
    }

    private suspend fun handleHistoryFragmentPayload(payload: String) {
        val json = JSONObject(payload)
        when (json.optString("type")) {
            "history_meta" -> {
                val meta = MobileJsonParser.parseHistoryMeta(payload)
                val scopeKey = meta.range.scopeKey
                pendingHistoryScopes.add(scopeKey)
                meta.requestId?.let { pendingHistoryRequests[it] = scopeKey }
                ensureDataset(meta.range, meta.generatedAt)
                emitState(
                    syncInProgress = hasPendingSync(),
                    statusMessage = context.getString(R.string.status_history_sync_in_progress),
                )
            }

            "history_dashboard_metrics" -> {
                persistMetricsFragment(MobileJsonParser.parseDashboardMetricsFragment(payload))
            }

            "history_dashboard_revenue" -> {
                persistRevenueFragment(MobileJsonParser.parseRevenueFragment(payload))
            }

            "history_queue_fragment" -> {
                persistHistoryQueueFragment(MobileJsonParser.parseQueueFragment(payload))
            }

            "history_complete" -> {
                val complete = MobileJsonParser.parseFragmentComplete(payload)
                val scopeKey = complete.range.scopeKey
                complete.requestId?.let { pendingHistoryRequests.remove(it) }
                pendingHistoryScopes.remove(scopeKey)

                if (complete.error != null) {
                    emitState(
                        syncInProgress = hasPendingSync(),
                        errorMessage = complete.error,
                    )
                    return
                }

                val dataset = markHistoryDatasetCompleted(complete.range, complete.generatedAt)
                if (!dataset.complete) {
                    emitState(
                        syncInProgress = hasPendingSync(),
                        errorMessage = context.getString(R.string.error_history_incomplete),
                    )
                    return
                }

                loadScope(
                    complete.range.scopeKey,
                    statusMessage = context.getString(R.string.status_history_updated_message),
                )
            }
        }
    }

    private suspend fun handleAuxiliaryPayload(payload: String) {
        val json = JSONObject(payload)
        val type = json.optString("type")

        when (type) {
            "manager_web_session_closed" -> emitState(
                statusMessage = context.getString(R.string.status_web_session_closed_message),
                errorMessage = null,
            )

            "manager_web_session_close_rejected" -> emitState(
                errorMessage = json.optString("error").ifBlank {
                    context.getString(R.string.error_close_web_rejected)
                }
            )
        }
    }

    private suspend fun publishLoginRequest() {
        try {
            mqttClient.publish(
                topics.loginRequest,
                JSONObject(
                    AndroidLoginRequest(
                        requestId = UUID.randomUUID().toString(),
                        deviceId = config.deviceId,
                        username = config.managerUsername,
                        password = config.managerPassword,
                    ).toMap()
                ).toString()
            )
            emitState(
                syncInProgress = true,
                statusMessage = context.getString(R.string.status_login_request_sent),
            )
        } catch (error: Exception) {
            emitState(errorMessage = resolveClientMessage(error.message))
        }
    }

    private suspend fun publishHistoryRequest(fromUtc: String, toUtc: String) {
        try {
            val range = DatasetRange(
                scopeKind = "history",
                fromUtc = fromUtc,
                toUtc = toUtc,
            )
            val requestId = UUID.randomUUID().toString()
            pendingHistoryRequests[requestId] = range.scopeKey
            pendingHistoryScopes.add(range.scopeKey)
            ensureDataset(range, generatedAt = "")

            mqttClient.publish(
                topics.historyRequest,
                JSONObject(
                    AndroidHistoryRequest(
                        requestId = requestId,
                        deviceId = config.deviceId,
                        fromUtc = fromUtc,
                        toUtc = toUtc,
                    ).toMap()
                ).toString()
            )
            emitState(
                syncInProgress = hasPendingSync(),
                statusMessage = context.getString(R.string.status_history_request_sent),
                errorMessage = null,
            )
        } catch (error: Exception) {
            emitState(errorMessage = resolveClientMessage(error.message))
        }
    }

    private suspend fun ensureDataset(
        range: DatasetRange,
        generatedAt: String,
        newFragments: Set<String> = emptySet(),
        completeOverride: Boolean? = null,
    ): CachedDatasetEntity {
        val existing = dao.getDataset(range.scopeKey)
        val mergedFragments = existing.fragmentSetOrEmpty() + newFragments
        val nextGeneratedAt = maxGeneratedAt(existing?.generatedAt, generatedAt)
        val nextComplete = completeOverride ?: existing?.complete ?: false

        val dataset = CachedDatasetEntity(
            scopeKey = range.scopeKey,
            scopeKind = range.scopeKind,
            fromUtc = range.fromUtc,
            toUtc = range.toUtc,
            generatedAt = nextGeneratedAt,
            fragmentsReadyCsv = mergedFragments.sorted().joinToString(","),
            complete = nextComplete,
        )
        dao.upsertDataset(dataset)
        return dataset
    }

    private suspend fun persistMetricsFragment(fragment: DashboardMetricsFragmentModel): CachedDatasetEntity {
        val dataset = ensureDataset(
            range = fragment.range,
            generatedAt = fragment.generatedAt,
            newFragments = setOf(FRAGMENT_DASHBOARD_METRICS),
        )
        dao.deleteMetrics(fragment.range.scopeKey)
        dao.insertMetrics(
            fragment.metrics.map {
                DashboardMetricEntity(
                    scopeKey = fragment.range.scopeKey,
                    cola = it.cola,
                    pendientes = it.pendientes,
                    atendidos = it.atendidos,
                    tiempoMedioSegundos = it.tiempoMedioSegundos,
                    tiempoMinimoSegundos = it.tiempoMinimoSegundos,
                    tiempoMaximoSegundos = it.tiempoMaximoSegundos,
                )
            }
        )
        return finalizeDatasetCompleteness(fragment.range, dataset)
    }

    private suspend fun persistRevenueFragment(fragment: RevenueFragmentModel): CachedDatasetEntity {
        val dataset = ensureDataset(
            range = fragment.range,
            generatedAt = fragment.generatedAt,
            newFragments = setOf(FRAGMENT_DASHBOARD_REVENUE),
        )
        dao.deleteRevenue(fragment.range.scopeKey)
        dao.insertRevenue(
            fragment.revenueByTable.map {
                RevenueByTableEntity(
                    scopeKey = fragment.range.scopeKey,
                    mesaNumero = it.mesaNumero,
                    totalArsCentavos = it.totalArsCentavos,
                )
            }
        )
        return finalizeDatasetCompleteness(fragment.range, dataset)
    }

    private suspend fun persistCurrentQueueFragment(fragment: QueueFragmentModel): CachedDatasetEntity {
        val dataset = ensureDataset(
            range = fragment.range,
            generatedAt = fragment.generatedAt,
            newFragments = setOf(currentQueueFragmentKey(fragment.queueType, fragment.status ?: "pendiente")),
        )
        dao.deleteQueueItemsByTypeAndStatus(
            scopeKey = fragment.range.scopeKey,
            queueType = fragment.queueType,
            status = fragment.status ?: "pendiente",
        )
        upsertQueueItems(fragment)
        return finalizeDatasetCompleteness(fragment.range, dataset)
    }

    private suspend fun persistHistoryQueueFragment(fragment: QueueFragmentModel): CachedDatasetEntity {
        val dataset = ensureDataset(
            range = fragment.range,
            generatedAt = fragment.generatedAt,
            newFragments = setOf(historyQueueFragmentKey(fragment.queueType)),
        )
        dao.deleteQueueItemsByType(
            scopeKey = fragment.range.scopeKey,
            queueType = fragment.queueType,
        )
        upsertQueueItems(fragment)
        return finalizeDatasetCompleteness(fragment.range, dataset)
    }

    private suspend fun upsertQueueItems(fragment: QueueFragmentModel) {
        dao.insertQueueItems(
            fragment.items.map {
                QueueItemEntity(
                    scopeKey = fragment.range.scopeKey,
                    queueType = it.queueType,
                    itemId = it.itemId,
                    status = it.status,
                    mesaNumero = it.mesaNumero,
                    mesaSesionId = it.mesaSesionId,
                    createdAt = it.createdAt,
                    closedAt = it.closedAt,
                    actorReference = it.actorReference,
                    summary = it.summary,
                    totalArsCentavos = it.totalArsCentavos,
                    detailJson = it.detailJson,
                )
            }
        )
    }

    private suspend fun finalizeDatasetCompleteness(
        range: DatasetRange,
        dataset: CachedDatasetEntity,
    ): CachedDatasetEntity {
        val expectedFragments = expectedFragmentsForRange(range)
        val isComplete = dataset.fragmentSet().containsAll(expectedFragments)

        if (dataset.complete == isComplete) {
            return dataset
        }

        return ensureDataset(
            range = range,
            generatedAt = dataset.generatedAt,
            completeOverride = isComplete,
            newFragments = dataset.fragmentSet(),
        )
    }

    private suspend fun markHistoryDatasetCompleted(
        range: DatasetRange,
        generatedAt: String,
    ): CachedDatasetEntity {
        val dataset = ensureDataset(range = range, generatedAt = generatedAt)
        val isComplete = dataset.fragmentSet().containsAll(expectedFragmentsForRange(range))

        return ensureDataset(
            range = range,
            generatedAt = generatedAt,
            completeOverride = isComplete,
            newFragments = dataset.fragmentSet(),
        )
    }

    private suspend fun loadScope(scopeKey: String, statusMessage: String? = null) {
        val dataset = dao.getDataset(scopeKey) ?: return
        activeScopeKey = scopeKey

        val metrics = dao.getMetrics(scopeKey).map {
            DashboardMetricUi(
                cola = it.cola,
                pendientes = it.pendientes,
                atendidos = it.atendidos,
                tiempoMedioSegundos = it.tiempoMedioSegundos,
                tiempoMinimoSegundos = it.tiempoMinimoSegundos,
                tiempoMaximoSegundos = it.tiempoMaximoSegundos,
            )
        }

        val revenue = dao.getRevenue(scopeKey).map {
            RevenueByTableUi(
                mesaNumero = it.mesaNumero,
                totalArsCentavos = it.totalArsCentavos,
            )
        }

        val pendingItems = dao.getQueueItems(scopeKey, "pendiente").map {
            QueueItemUi(
                queueType = it.queueType,
                itemId = it.itemId,
                status = it.status,
                mesaNumero = it.mesaNumero,
                createdAt = it.createdAt,
                closedAt = it.closedAt,
                actorReference = it.actorReference,
                summary = it.summary,
                totalArsCentavos = it.totalArsCentavos,
                detailJson = it.detailJson,
            )
        }

        val attendedItems = dao.getQueueItems(scopeKey, "atendido").map {
            QueueItemUi(
                queueType = it.queueType,
                itemId = it.itemId,
                status = it.status,
                mesaNumero = it.mesaNumero,
                createdAt = it.createdAt,
                closedAt = it.closedAt,
                actorReference = it.actorReference,
                summary = it.summary,
                totalArsCentavos = it.totalArsCentavos,
                detailJson = it.detailJson,
            )
        }

        emitState(
            loading = false,
            syncInProgress = hasPendingSync(),
            scopeComplete = dataset.complete,
            brokerOnline = brokerOnline,
            managerAuthenticated = managerAuthenticated,
            activeScopeLabel = context.getString(
                R.string.status_scope_range_label,
                dataset.fromUtc,
                dataset.toUtc,
            ),
            lastSyncAt = dataset.generatedAt.ifBlank { null },
            statusMessage = statusMessage,
            errorMessage = null,
            dashboardMetrics = metrics,
            revenueByTable = revenue,
            pendingItems = pendingItems,
            attendedItems = attendedItems,
        )
    }

    private fun emitState(
        loading: Boolean = mutableUiState.value.loading,
        syncInProgress: Boolean = mutableUiState.value.syncInProgress,
        scopeComplete: Boolean = mutableUiState.value.scopeComplete,
        brokerOnline: Boolean = this.brokerOnline,
        managerAuthenticated: Boolean = this.managerAuthenticated,
        activeScopeLabel: String = mutableUiState.value.activeScopeLabel,
        lastSyncAt: String? = mutableUiState.value.lastSyncAt,
        statusMessage: String? = mutableUiState.value.statusMessage,
        errorMessage: String? = mutableUiState.value.errorMessage,
        dashboardMetrics: List<DashboardMetricUi> = mutableUiState.value.dashboardMetrics,
        revenueByTable: List<RevenueByTableUi> = mutableUiState.value.revenueByTable,
        pendingItems: List<QueueItemUi> = mutableUiState.value.pendingItems,
        attendedItems: List<QueueItemUi> = mutableUiState.value.attendedItems,
    ) {
        mutableUiState.value = MainUiState(
            loading = loading,
            syncInProgress = syncInProgress,
            scopeComplete = scopeComplete,
            brokerOnline = brokerOnline,
            managerAuthenticated = managerAuthenticated,
            activeScopeLabel = activeScopeLabel,
            lastSyncAt = lastSyncAt,
            statusMessage = statusMessage,
            errorMessage = errorMessage,
            dashboardMetrics = dashboardMetrics,
            revenueByTable = revenueByTable,
            pendingItems = pendingItems,
            attendedItems = attendedItems,
        )
    }

    private fun hasPendingSync(): Boolean {
        return currentSyncScopeKey != null || pendingHistoryScopes.isNotEmpty()
    }

    private fun expectedFragmentsForRange(range: DatasetRange): Set<String> {
        return if (range.scopeKind == "current") {
            CURRENT_EXPECTED_FRAGMENTS
        } else {
            setOf(
                FRAGMENT_DASHBOARD_METRICS,
                FRAGMENT_DASHBOARD_REVENUE,
                historyQueueFragmentKey("consultas"),
                historyQueueFragmentKey("pedidosCocina"),
                historyQueueFragmentKey("llamadosMozo"),
            )
        }
    }

    private fun resolveClientMessage(message: String?): String? {
        return when (message) {
            "mqtt_not_connected" -> context.getString(R.string.error_mqtt_not_connected)
            "mqtt_connection_lost" -> context.getString(R.string.error_mqtt_connection_lost)
            "mqtt_connect_failed" -> context.getString(R.string.error_mqtt_connect_failed)
            "mqtt_subscribe_failed" -> context.getString(R.string.error_mqtt_subscribe_failed)
            "mqtt_publish_failed" -> context.getString(R.string.error_mqtt_publish_failed)
            else -> message
        }
    }
}

private fun AndroidLoginRequest.toMap(): Map<String, String> {
    return mapOf(
        "requestId" to requestId,
        "deviceId" to deviceId,
        "username" to username,
        "password" to password,
    )
}

private fun AndroidHistoryRequest.toMap(): Map<String, String> {
    return mapOf(
        "requestId" to requestId,
        "deviceId" to deviceId,
        "fromUtc" to fromUtc,
        "toUtc" to toUtc,
    )
}

private fun AndroidCloseWebSessionRequest.toMap(): Map<String, String> {
    return mapOf(
        "requestId" to requestId,
        "deviceId" to deviceId,
    )
}

private fun CachedDatasetEntity.fragmentSet(): Set<String> {
    return fragmentsReadyCsv
        .split(",")
        .map { it.trim() }
        .filter { it.isNotEmpty() }
        .toSet()
}

private fun CachedDatasetEntity?.fragmentSetOrEmpty(): Set<String> {
    return this?.fragmentSet().orEmpty()
}

private fun maxGeneratedAt(current: String?, incoming: String): String {
    if (current.isNullOrBlank()) {
        return incoming
    }

    if (incoming.isBlank()) {
        return current
    }

    return if (incoming > current) incoming else current
}

private fun queueFragmentKey(queueType: String, status: String): String {
    return "$status.$queueType"
}

private fun currentQueueFragmentKey(queueType: String, status: String): String {
    return "$FRAGMENT_CURRENT_QUEUE_PREFIX${queueFragmentKey(queueType, status)}"
}

private fun historyQueueFragmentKey(queueType: String): String {
    return "$FRAGMENT_HISTORY_QUEUE_PREFIX$queueType"
}
