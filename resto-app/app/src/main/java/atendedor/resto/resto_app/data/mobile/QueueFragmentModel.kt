package atendedor.resto.resto_app.data.mobile

import kotlinx.serialization.Serializable

@Serializable
data class QueueFragmentModel(
    val range: DatasetRange,
    val generatedAt: String,
    val requestId: String? = null,
    val queueType: String,
    val status: String? = null,
    val items: List<QueueItemModel>,
)
