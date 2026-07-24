package atendedor.resto.resto_app.data.mobile

data class CachedDatasetModel(
    val range: DatasetRange,
    val generatedAt: String,
    val dashboardMetrics: List<DashboardMetricModel>,
    val revenueByTable: List<RevenueByTableModel>,
    val queueItems: List<QueueItemModel>,
)
