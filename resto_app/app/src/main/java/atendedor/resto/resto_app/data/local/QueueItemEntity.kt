package atendedor.resto.resto_app.data.local

import androidx.room.Entity

@Entity(
    tableName = "queue_items",
    primaryKeys = ["scopeKey", "queueType", "itemId"],
)
data class QueueItemEntity(
    val scopeKey: String,
    val queueType: String,
    val itemId: Long,
    val status: String,
    val mesaNumero: String,
    val mesaSesionId: Long,
    val createdAt: String,
    val closedAt: String?,
    val actorReference: String?,
    val summary: String?,
    val totalArsCentavos: Long?,
    val detailJson: String,
)
