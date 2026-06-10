package atendedor.resto.resto_app.data.mobile

import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName
import kotlinx.serialization.json.JsonElement

@Serializable
data class QueueItemModel(
    @SerialName("id") val itemId: Long,
    @SerialName("estado") val status: String? = null,
    val mesaNumero: String,
    val mesaSesionId: Long,
    @SerialName("creadaEn") val createdAt: String,
    val atendidaEn: String? = null,
    val cerradaEn: String? = null,
    val atendidaPor: String? = null,
    val cerradaPor: String? = null,
    val resumen: String? = null,
    val totalArsCentavos: Long? = null,
    @SerialName("detalle") val detail: JsonElement? = null,
    // Este campo no viene en el JSON individual, se inyecta desde el fragmento
    val queueType: String = ""
) {
    val effectiveStatus: String get() = status ?: "pendiente"
    val effectiveClosedAt: String? get() = atendidaEn ?: cerradaEn
    val effectiveActorReference: String? get() = atendidaPor ?: cerradaPor
}
