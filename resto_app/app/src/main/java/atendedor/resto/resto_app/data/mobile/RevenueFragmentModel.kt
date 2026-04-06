package atendedor.resto.resto_app.data.mobile

data class RevenueFragmentModel(
    val range: DatasetRange,
    val generatedAt: String,
    val revenueByTable: List<RevenueByTableModel>,
)
