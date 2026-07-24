package atendedor.resto.resto_app.data.mobile

import kotlinx.serialization.Serializable

@Serializable
data class HistoryMetaModel(
    val range: DatasetRange,
    val generatedAt: String,
    val requestId: String? = null,
)
