package atendedor.resto.resto_app.data.mobile

data class QueueItemModel(
    val queueType: String,
    val itemId: Long,
    val status: String,
    val mesaNumero: Int,
    val mesaSesionId: Long,
    val createdAt: String,
    val closedAt: String?,
    val actorReference: String?,
    val summary: String?,
    val totalArsCentavos: Long?,
    val detailJson: String,
)
