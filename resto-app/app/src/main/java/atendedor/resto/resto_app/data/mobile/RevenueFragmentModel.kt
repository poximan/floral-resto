package atendedor.resto.resto_app.data.mobile

import kotlinx.serialization.Serializable

@Serializable
data class RevenueFragmentModel(
    val range: DatasetRange,
    val generatedAt: String,
    val revenueByTable: List<RevenueByTableModel>,
)
