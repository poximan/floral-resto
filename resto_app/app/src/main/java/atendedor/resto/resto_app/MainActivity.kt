package atendedor.resto.resto_app

import android.os.Bundle
import atendedor.resto.resto_app.BuildConfig
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.PrimaryScrollableTabRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.tooling.preview.PreviewScreenSizes
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import atendedor.resto.resto_app.config.MqttConfigProvider
import atendedor.resto.resto_app.ui.MainUiState
import atendedor.resto.resto_app.ui.MainViewModel
import atendedor.resto.resto_app.ui.QueueItemUi
import atendedor.resto.resto_app.ui.theme.BarClay
import atendedor.resto.resto_app.ui.theme.BarNightSurfaceAlt
import atendedor.resto.resto_app.ui.theme.BarRoseSoft
import atendedor.resto.resto_app.ui.theme.StatusAmber
import atendedor.resto.resto_app.ui.theme.StatusGreen
import atendedor.resto.resto_app.ui.theme.Resto_appTheme
import atendedor.resto.resto_app.ui.theme.StatusRed
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            val application = application as RestoApplication
            val viewModel: MainViewModel = viewModel(
                factory = MainViewModel.factory(application.managerMobileRepository)
            )

            Resto_appTheme {
                RestoApp(viewModel = viewModel)
            }
        }
    }
}

@Composable
fun RestoApp(viewModel: MainViewModel) {
    val uiState by viewModel.uiState.collectAsState()
    RestoAppContent(
        uiState = uiState,
        onRequestCurrent = viewModel::requestCurrentScope,
        onRequestHistory = viewModel::requestHistory,
        onCloseWebSession = viewModel::closeManagerWebSession,
    )
}

@Composable
private fun RestoAppContent(
    uiState: MainUiState,
    onRequestCurrent: () -> Unit = {},
    onRequestHistory: (String, String) -> Unit = { _, _ -> },
    onCloseWebSession: () -> Unit = {},
) {
    val pages = remember {
        listOf(
            AppPage(R.string.dashboard_tab, AppPageStyle.Dashboard),
            AppPage(R.string.pending_tab, AppPageStyle.Pending),
            AppPage(R.string.attended_tab, AppPageStyle.Attended),
            AppPage(R.string.settings_tab, AppPageStyle.Settings),
        )
    }
    val pagerState = rememberPagerState(pageCount = { pages.size })
    val coroutineScope = rememberCoroutineScope()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
    ) {
        HeaderCard(
            uiState = uiState,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 10.dp)
        )

        PrimaryScrollableTabRow(
            selectedTabIndex = pagerState.currentPage,
            edgePadding = 10.dp,
            modifier = Modifier.fillMaxWidth(),
            containerColor = MaterialTheme.colorScheme.surface,
            divider = {},
        ) {
            pages.forEachIndexed { index, page ->
                val selected = pagerState.currentPage == index
                val accentColor = pageAccentColor(page.style)
                val accentContainer = pageAccentContainer(page.style)

                Tab(
                    selected = selected,
                    onClick = {
                        coroutineScope.launch {
                            pagerState.animateScrollToPage(index)
                        }
                    },
                    selectedContentColor = accentColor,
                    unselectedContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                    text = {
                        Surface(
                            shape = RoundedCornerShape(999.dp),
                            color = if (selected) accentContainer else Color.Transparent,
                            border = androidx.compose.foundation.BorderStroke(
                                width = if (selected) 1.dp else 0.dp,
                                color = if (selected) accentColor.copy(alpha = 0.45f) else Color.Transparent,
                            ),
                        ) {
                            Text(
                                text = stringResource(id = page.titleResId),
                                modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                                color = if (selected) accentColor else MaterialTheme.colorScheme.onSurfaceVariant,
                                fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                            )
                        }
                    },
                )
            }
        }

        HorizontalPager(
            state = pagerState,
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = 4.dp),
        ) { index ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 10.dp, vertical = 8.dp)
            ) {
                when (index) {
                    0 -> DashboardScreen(uiState = uiState)
                    1 -> QueueScreen(
                        titleResId = R.string.pending_title,
                        items = uiState.pendingItems,
                        pageStyle = AppPageStyle.Pending,
                    )

                    2 -> QueueScreen(
                        titleResId = R.string.attended_title,
                        items = uiState.attendedItems,
                        pageStyle = AppPageStyle.Attended,
                    )

                    else -> SettingsScreen(
                        uiState = uiState,
                        onRequestCurrent = onRequestCurrent,
                        onRequestHistory = onRequestHistory,
                        onCloseWebSession = onCloseWebSession,
                    )
                }
            }
        }
    }
}

@Composable
private fun HeaderCard(uiState: MainUiState, modifier: Modifier = Modifier) {
    val businessName = remember { BuildConfig.BUSINESS_NAME }
    val lastSyncLabel = if (uiState.lastSyncAt.isNullOrBlank()) {
        stringResource(id = R.string.header_last_sync_pending)
    } else {
        stringResource(id = R.string.header_last_sync_ready, uiState.lastSyncAt)
    }

    Card(
        modifier = modifier,
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface,
        ),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = businessName,
                style = MaterialTheme.typography.headlineSmall,
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.Bold,
            )
            Text(
                text = stringResource(id = R.string.manager_mobile_subtitle),
                style = MaterialTheme.typography.labelLarge,
            )
            Surface(
                shape = RoundedCornerShape(14.dp),
                color = MaterialTheme.colorScheme.primary.copy(alpha = 0.14f),
            ) {
                Text(
                    text = lastSyncLabel,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
        }
    }
}

@Composable
private fun DashboardScreen(uiState: MainUiState) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 8.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (uiState.dashboardMetrics.isEmpty()) {
            item {
                MetricCard(
                    title = stringResource(id = R.string.feedback_title),
                    value = stringResource(id = R.string.empty_dashboard),
                )
            }
        } else {
            items(uiState.dashboardMetrics) { metric ->
                MetricCard(
                    title = queueTypeLabel(metric.cola),
                    value = "${metric.pendientes} / ${metric.atendidos}",
                    supporting = listOf(
                        stringResource(id = R.string.queue_detail_line_avg, metric.tiempoMedioSegundos),
                        stringResource(id = R.string.queue_detail_line_min, metric.tiempoMinimoSegundos),
                        stringResource(id = R.string.queue_detail_line_max, metric.tiempoMaximoSegundos),
                    ),
                )
            }
        }

        item {
            MetricCard(
                title = stringResource(id = R.string.metric_total_amount_title),
                value = formatMoney(uiState.revenueByTable.sumOf { it.totalArsCentavos }),
            )
        }

        items(uiState.revenueByTable) { item ->
            MetricCard(
                title = stringResource(id = R.string.queue_table_title, item.mesaNumero),
                value = formatMoney(item.totalArsCentavos),
            )
        }
    }
}

@Composable
private fun QueueScreen(
    titleResId: Int,
    items: List<QueueItemUi>,
    pageStyle: AppPageStyle,
) {
    var selectedItemId by rememberSaveable { mutableStateOf<Long?>(null) }
    val selectedItem = items.firstOrNull { it.itemId == selectedItemId } ?: items.firstOrNull()
    val accentColor = pageAccentColor(pageStyle)
    val accentContainer = pageAccentContainer(pageStyle)

    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Surface(
            shape = RoundedCornerShape(18.dp),
            color = MaterialTheme.colorScheme.surface,
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = stringResource(id = titleResId),
                    style = MaterialTheme.typography.titleMedium,
                    color = accentColor,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    text = stringResource(id = R.string.queue_count_label, items.size),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }

        if (items.isEmpty()) {
            Card(
                shape = RoundedCornerShape(18.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            ) {
                Text(
                    text = stringResource(id = R.string.empty_queue),
                    modifier = Modifier.padding(16.dp),
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier.weight(1f),
                contentPadding = PaddingValues(bottom = 6.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(items) { item ->
                    Card(
                        shape = RoundedCornerShape(18.dp),
                        colors = CardDefaults.cardColors(
                            containerColor = if (item.itemId == selectedItemId) {
                                accentContainer
                            } else {
                                MaterialTheme.colorScheme.surface
                            }
                        ),
                        modifier = Modifier
                            .fillMaxWidth()
                            .border(
                                width = if (item.itemId == selectedItemId) 1.5.dp else 0.dp,
                                color = if (item.itemId == selectedItemId) {
                                    accentColor.copy(alpha = 0.5f)
                                } else {
                                    MaterialTheme.colorScheme.outline.copy(alpha = 0.12f)
                                },
                                shape = RoundedCornerShape(18.dp),
                            )
                            .clickable { selectedItemId = item.itemId },
                    ) {
                        Column(
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text(
                                text = stringResource(
                                    id = R.string.queue_item_heading,
                                    queueTypeLabel(item.queueType),
                                    item.mesaNumero,
                                ),
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold,
                                color = if (item.itemId == selectedItemId) accentColor else MaterialTheme.colorScheme.onSurface,
                            )
                            item.summary?.let { summary ->
                                Text(
                                    text = stringResource(id = R.string.queue_summary_label, summary),
                                    style = MaterialTheme.typography.bodyMedium,
                                )
                            }
                            Text(
                                text = stringResource(id = R.string.queue_created_at_label, item.createdAt),
                                style = MaterialTheme.typography.bodySmall,
                            )
                            item.closedAt?.let { closedAt ->
                                Text(
                                    text = stringResource(id = R.string.queue_closed_at_label, closedAt),
                                    style = MaterialTheme.typography.bodySmall,
                                )
                            }
                        }
                    }
                }
            }
        }

        DetailCard(
            item = selectedItem,
            accentColor = accentColor,
        )
    }
}

@Composable
private fun DetailCard(
    item: QueueItemUi?,
    accentColor: Color,
) {
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface,
        ),
        border = androidx.compose.foundation.BorderStroke(
            width = 1.dp,
            color = accentColor.copy(alpha = 0.18f),
        ),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = stringResource(id = R.string.queue_detail_title),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = accentColor,
            )

            if (item == null) {
                Text(
                    text = stringResource(id = R.string.queue_detail_placeholder),
                    style = MaterialTheme.typography.bodyMedium,
                )
            } else {
                Text(
                    text = stringResource(
                        id = R.string.queue_item_heading,
                        queueTypeLabel(item.queueType),
                        item.mesaNumero,
                    ),
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Bold,
                )
                item.summary?.let { summary ->
                    Text(
                        text = stringResource(id = R.string.queue_summary_label, summary),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
                item.totalArsCentavos?.let { total ->
                    Text(
                        text = stringResource(id = R.string.queue_total_label, formatMoney(total)),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
                item.closedAt?.let { closedAt ->
                    Text(
                        text = stringResource(id = R.string.queue_closed_at_label, closedAt),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
                item.actorReference?.let { actorReference ->
                    Text(
                        text = stringResource(id = R.string.queue_actor_label, actorReference),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
                itemDetailLines(
                    detailJson = item.detailJson,
                    fallback = stringResource(id = R.string.queue_detail_json_fallback),
                ).forEach { line ->
                    Text(
                        text = line,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
    }
}

@Composable
private fun SettingsScreen(
    uiState: MainUiState,
    onRequestCurrent: () -> Unit,
    onRequestHistory: (String, String) -> Unit,
    onCloseWebSession: () -> Unit,
) {
    val mqttConfig = remember { MqttConfigProvider.load() }
    var historyFrom by rememberSaveable { mutableStateOf("") }
    var historyTo by rememberSaveable { mutableStateOf("") }
    val brokerStatusText = if (uiState.brokerOnline) {
        stringResource(id = R.string.broker_online)
    } else {
        stringResource(id = R.string.broker_offline)
    }
    val sessionStatusText = if (uiState.managerAuthenticated) {
        stringResource(id = R.string.status_authenticated)
    } else {
        stringResource(id = R.string.status_not_authenticated)
    }
    val detailStatusText = when {
        uiState.managerAuthenticated -> stringResource(id = R.string.status_authenticated_detail)
        uiState.brokerOnline -> stringResource(id = R.string.status_waiting_login_detail)
        else -> stringResource(id = R.string.status_waiting_broker_detail)
    }
    val syncStatusText = if (uiState.syncInProgress) {
        stringResource(id = R.string.status_sync_in_progress)
    } else {
        stringResource(id = R.string.status_sync_idle)
    }
    val scopeStatusText = when {
        uiState.activeScopeLabel.isBlank() -> stringResource(id = R.string.status_scope_label, "sin datos")
        uiState.scopeComplete -> stringResource(id = R.string.status_scope_complete_label)
        else -> stringResource(id = R.string.status_scope_partial_label)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        MetricCard(
            title = stringResource(id = R.string.settings_connection_status_title),
            value = stringResource(id = R.string.status_broker_label, brokerStatusText),
            accentContainer = if (uiState.brokerOnline) {
                statusContainerColor(StatusGreen)
            } else {
                statusContainerColor(StatusRed)
            },
            accentContent = if (uiState.brokerOnline) StatusGreen else StatusRed,
            supporting = listOf(
                stringResource(id = R.string.status_session_label, sessionStatusText),
                stringResource(id = R.string.status_detail_label, detailStatusText),
                stringResource(id = R.string.manager_mobile_broker_summary, mqttConfig.host, mqttConfig.port),
            ),
        )
        MetricCard(
            title = stringResource(id = R.string.settings_connection_scope_title),
            value = if (uiState.activeScopeLabel.isNotBlank()) {
                stringResource(id = R.string.status_scope_label, uiState.activeScopeLabel)
            } else {
                stringResource(id = R.string.status_scope_label, "sin datos")
            },
            accentContainer = if (uiState.scopeComplete) {
                statusContainerColor(StatusGreen)
            } else {
                statusContainerColor(StatusAmber)
            },
            accentContent = if (uiState.scopeComplete) StatusGreen else StatusAmber,
            supporting = buildList {
                add(scopeStatusText)
                uiState.lastSyncAt?.let { add(stringResource(id = R.string.status_last_sync_label, it)) }
            },
        )
        MetricCard(
            title = stringResource(id = R.string.settings_connection_sync_title),
            value = syncStatusText,
            accentContainer = if (uiState.syncInProgress) {
                statusContainerColor(StatusAmber)
            } else {
                statusContainerColor(StatusGreen)
            },
            accentContent = if (uiState.syncInProgress) StatusAmber else StatusGreen,
            supporting = listOf(
                stringResource(id = R.string.settings_timeout_value, mqttConfig.timeoutSeconds),
                stringResource(id = R.string.settings_base_topic_title) + " " + mqttConfig.baseTopic,
                stringResource(id = R.string.settings_device_id_title) + " " + mqttConfig.deviceId,
                stringResource(id = R.string.settings_manager_username_title) + " " + mqttConfig.managerUsername,
            ),
        )

        Card(
            shape = RoundedCornerShape(18.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        ) {
            Column(
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    text = stringResource(id = R.string.settings_description),
                    style = MaterialTheme.typography.bodyMedium,
                )
                Button(onClick = onRequestCurrent) {
                    Text(text = stringResource(id = R.string.settings_request_current))
                }
                OutlinedTextField(
                    value = historyFrom,
                    onValueChange = { historyFrom = it },
                    label = { Text(text = stringResource(id = R.string.settings_history_from_title)) },
                    placeholder = { Text(text = stringResource(id = R.string.settings_history_hint_from)) },
                    modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text),
                )
                OutlinedTextField(
                    value = historyTo,
                    onValueChange = { historyTo = it },
                    label = { Text(text = stringResource(id = R.string.settings_history_to_title)) },
                    placeholder = { Text(text = stringResource(id = R.string.settings_history_hint_to)) },
                    modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text),
                )
                Button(
                    onClick = { onRequestHistory(historyFrom.trim(), historyTo.trim()) },
                    enabled = historyFrom.isNotBlank() && historyTo.isNotBlank(),
                ) {
                    Text(text = stringResource(id = R.string.settings_history_request))
                }
                TextButton(onClick = onCloseWebSession) {
                    Text(text = stringResource(id = R.string.close_web_session))
                }
            }
        }

        uiState.statusMessage?.let { status ->
            MetricCard(
                title = stringResource(id = R.string.feedback_title),
                value = status,
                accentContainer = statusContainerColor(StatusGreen),
                accentContent = StatusGreen,
            )
        }

        uiState.errorMessage?.let { error ->
            MetricCard(
                title = stringResource(id = R.string.feedback_title),
                value = error,
                accentContainer = statusContainerColor(StatusRed),
                accentContent = StatusRed,
            )
        }
    }
}

@Composable
private fun MetricCard(
    title: String,
    value: String,
    supporting: List<String> = emptyList(),
    accentContainer: Color = MaterialTheme.colorScheme.primary.copy(alpha = 0.14f),
    accentContent: Color = MaterialTheme.colorScheme.primary,
) {
    Card(
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface,
        ),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.labelLarge,
                    color = accentContent,
                )
                Text(
                    text = value,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                supporting.forEach { line ->
                    Text(
                        text = line,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Box(
                modifier = Modifier
                    .padding(start = 10.dp, top = 4.dp)
                    .size(12.dp)
                    .background(
                        color = accentContainer,
                        shape = RoundedCornerShape(999.dp),
                    )
            )
        }
    }
}

@Composable
private fun statusContainerColor(baseColor: Color): Color {
    val darkTheme = isSystemInDarkTheme()
    val alpha = if (darkTheme) 0.34f else 0.16f
    return baseColor.copy(alpha = alpha)
}

@Composable
private fun pageAccentColor(style: AppPageStyle): Color {
    return when (style) {
        AppPageStyle.Dashboard -> MaterialTheme.colorScheme.primary
        AppPageStyle.Pending -> MaterialTheme.colorScheme.primary
        AppPageStyle.Attended -> MaterialTheme.colorScheme.primary
        AppPageStyle.Settings -> BarClay
    }
}

@Composable
private fun pageAccentContainer(style: AppPageStyle): Color {
    val darkTheme = isSystemInDarkTheme()

    return when (style) {
        AppPageStyle.Dashboard -> dashboardAccentContainer(darkTheme)
        AppPageStyle.Pending -> dashboardAccentContainer(darkTheme)
        AppPageStyle.Attended -> dashboardAccentContainer(darkTheme)
        AppPageStyle.Settings -> if (darkTheme) BarNightSurfaceAlt else BarRoseSoft
    }
}

@Composable
private fun dashboardAccentContainer(darkTheme: Boolean): Color {
    return MaterialTheme.colorScheme.primary.copy(alpha = if (darkTheme) 0.24f else 0.14f)
}

@Composable
private fun queueTypeLabel(queueType: String): String {
    return when (queueType) {
        "consultas" -> stringResource(id = R.string.queue_type_consultas)
        "pedidos_cocina", "pedidosCocina" -> stringResource(id = R.string.queue_type_pedidos)
        "llamados_mozo", "llamadosMozo" -> stringResource(id = R.string.queue_type_llamados)
        else -> queueType
    }
}

private fun formatMoney(arsCentavos: Long): String {
    val locale = java.util.Locale.Builder()
        .setLanguage("es")
        .setRegion("AR")
        .build()

    return java.text.NumberFormat.getCurrencyInstance(locale)
        .format(arsCentavos / 100.0)
}

private fun itemDetailLines(detailJson: String, fallback: String): List<String> {
    return try {
        val detail = JSONObject(detailJson)
        if (detail.length() == 0) {
            return listOf(fallback)
        }

        if (detail.has("mensajes")) {
            val messages = detail.getJSONArray("mensajes")
            return buildList {
                for (index in 0 until messages.length()) {
                    val message = messages.getJSONObject(index)
                    add("${message.optString("autorTipo")}: ${message.optString("contenido")}")
                }
            }
        }

        if (detail.has("items")) {
            val items = detail.getJSONArray("items")
            return buildList {
                for (index in 0 until items.length()) {
                    val item = items.getJSONObject(index)
                    add("${item.optString("titulo")} x${item.optInt("cantidad")} (${item.optString("clienteSesionId")})")
                }
            }
        }

        jsonLines(detail)
    } catch (_: Exception) {
        listOf(fallback)
    }
}

private fun jsonLines(jsonObject: JSONObject): List<String> {
    val keys = jsonObject.keys()
    val lines = mutableListOf<String>()
    while (keys.hasNext()) {
        val key = keys.next()
        val value = jsonObject.get(key)
        lines.add("$key: ${jsonValueToText(value)}")
    }
    return lines
}

private fun jsonValueToText(value: Any?): String {
    return when (value) {
        is JSONObject -> jsonLines(value).joinToString(separator = " | ")
        is JSONArray -> buildList {
            for (index in 0 until value.length()) {
                add(jsonValueToText(value.get(index)))
            }
        }.joinToString(separator = ", ")

        else -> value?.toString() ?: ""
    }
}

private fun previewUiState(): MainUiState {
    return MainUiState(
        loading = false,
        syncInProgress = false,
        scopeComplete = true,
        brokerOnline = true,
        managerAuthenticated = true,
        activeScopeLabel = "actual",
        lastSyncAt = "2026-04-04 16:35",
        statusMessage = "Snapshot recibido por MQTT",
        dashboardMetrics = listOf(
            atendedor.resto.resto_app.ui.DashboardMetricUi(
                cola = "consultas",
                pendientes = 2,
                atendidos = 14,
                tiempoMedioSegundos = 37,
                tiempoMinimoSegundos = 12,
                tiempoMaximoSegundos = 91,
            ),
            atendedor.resto.resto_app.ui.DashboardMetricUi(
                cola = "pedidosCocina",
                pendientes = 1,
                atendidos = 9,
                tiempoMedioSegundos = 52,
                tiempoMinimoSegundos = 20,
                tiempoMaximoSegundos = 145,
            ),
        ),
        revenueByTable = listOf(
            atendedor.resto.resto_app.ui.RevenueByTableUi(
                mesaNumero = 4,
                totalArsCentavos = 325000,
            ),
            atendedor.resto.resto_app.ui.RevenueByTableUi(
                mesaNumero = 8,
                totalArsCentavos = 218500,
            ),
        ),
        pendingItems = listOf(
            QueueItemUi(
                queueType = "consultas",
                itemId = 11,
                status = "pendiente",
                mesaNumero = 4,
                createdAt = "16:20",
                closedAt = null,
                actorReference = "A7C",
                summary = "Consulta por stock de vino",
                totalArsCentavos = null,
                detailJson = """{"mensajes":[{"autorTipo":"cliente","contenido":"Tienen malbec?"}]}""",
            ),
        ),
        attendedItems = listOf(
            QueueItemUi(
                queueType = "pedidosCocina",
                itemId = 21,
                status = "atendido",
                mesaNumero = 8,
                createdAt = "15:48",
                closedAt = "15:57",
                actorReference = "B2K",
                summary = "2 empanadas y 1 limonada",
                totalArsCentavos = 145000,
                detailJson = """{"items":[{"titulo":"Empanada","cantidad":2,"clienteSesionId":"B2K"},{"titulo":"Limonada","cantidad":1,"clienteSesionId":"B2K"}]}""",
            ),
        ),
    )
}

@PreviewScreenSizes
@Preview(showBackground = true)
@Composable
fun AppPreview() {
    Resto_appTheme {
        RestoAppContent(
            uiState = previewUiState(),
        )
    }
}
