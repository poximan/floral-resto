package atendedor.resto.resto_app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import atendedor.resto.resto_app.R
import atendedor.resto.resto_app.config.MqttConfigProvider
import atendedor.resto.resto_app.ui.MainUiState
import atendedor.resto.resto_app.ui.components.MetricCard
import atendedor.resto.resto_app.ui.components.statusContainerColor
import atendedor.resto.resto_app.ui.theme.StatusAmber
import atendedor.resto.resto_app.ui.theme.StatusGreen
import atendedor.resto.resto_app.ui.theme.StatusRed

@Composable
fun SettingsScreen(
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
                stringResource(
                    id = R.string.settings_management_url_label,
                    uiState.publicManagementUrl ?: stringResource(id = R.string.settings_management_url_pending),
                ),
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
                value = error.asString(),
                accentContainer = statusContainerColor(StatusRed),
                accentContent = StatusRed,
            )
        }
    }
}
