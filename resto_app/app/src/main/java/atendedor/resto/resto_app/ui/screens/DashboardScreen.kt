package atendedor.resto.resto_app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import atendedor.resto.resto_app.R
import atendedor.resto.resto_app.ui.MainUiState
import atendedor.resto.resto_app.ui.components.MetricCard
import atendedor.resto.resto_app.ui.utils.Formatters
import atendedor.resto.resto_app.ui.utils.UiUtils.queueTypeLabel

@Composable
fun DashboardScreen(uiState: MainUiState) {
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
                value = Formatters.formatMoney(uiState.revenueByTable.sumOf { it.totalArsCentavos }),
            )
        }

        items(uiState.revenueByTable) { item ->
            MetricCard(
                title = stringResource(id = R.string.queue_table_title, item.mesaNumero),
                value = Formatters.formatMoney(item.totalArsCentavos),
            )
        }
    }
}
