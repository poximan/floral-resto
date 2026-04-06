package atendedor.resto.resto_app.data.mobile

data class DashboardMetricsFragmentModel(
    val range: DatasetRange,
    val generatedAt: String,
    val metrics: List<DashboardMetricModel>,
)
