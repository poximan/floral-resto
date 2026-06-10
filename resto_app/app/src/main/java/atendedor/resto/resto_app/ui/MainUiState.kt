package atendedor.resto.resto_app.ui

import atendedor.resto.resto_app.ui.utils.UiError

data class MainUiState(
    val loading: Boolean = true,
    val syncInProgress: Boolean = false,
    val scopeComplete: Boolean = true,
    val brokerOnline: Boolean = false,
    val managerAuthenticated: Boolean = false,
    val activeScopeLabel: String = "",
    val lastSyncAt: String? = null,
    val publicManagementUrl: String? = null,
    val statusMessage: String? = null,
    val errorMessage: UiError? = null,
    val dashboardMetrics: List<DashboardMetricUi> = emptyList(),
    val revenueByTable: List<RevenueByTableUi> = emptyList(),
    val pendingItems: List<QueueItemUi> = emptyList(),
    val attendedItems: List<QueueItemUi> = emptyList(),
)
