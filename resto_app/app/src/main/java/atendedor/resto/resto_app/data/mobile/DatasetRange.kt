package atendedor.resto.resto_app.data.mobile

import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName

@Serializable
data class DatasetRange(
    @SerialName("scope") val scopeKind: String = "current",
    val fromUtc: String,
    val toUtc: String,
) {
    val scopeKey: String get() = "$scopeKind|$fromUtc|$toUtc"
}
