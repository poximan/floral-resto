package atendedor.resto.resto_app.ui

data class QueueItemUi(
    val queueType: String,
    val itemId: Long,
    val status: String,
    val mesaNumero: Int,
    val createdAt: String,
    val closedAt: String?,
    val actorReference: String?,
    val summary: String?,
    val totalArsCentavos: Long?,
    val detailJson: String,
)
