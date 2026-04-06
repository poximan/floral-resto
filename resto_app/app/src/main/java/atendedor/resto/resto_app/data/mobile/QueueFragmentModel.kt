package atendedor.resto.resto_app.data.mobile

data class QueueFragmentModel(
    val range: DatasetRange,
    val generatedAt: String,
    val requestId: String?,
    val queueType: String,
    val status: String?,
    val items: List<QueueItemModel>,
)
