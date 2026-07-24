package atendedor.resto.resto_app.data.mobile

import kotlinx.serialization.Serializable

@Serializable
data class RevenueByTableModel(
    val mesaNumero: String,
    val totalArsCentavos: Long,
)
