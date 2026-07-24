package atendedor.resto.resto_app.data.mobile

import kotlinx.serialization.Serializable

@Serializable
data class DashboardMetricModel(
    val cola: String,
    val pendientes: Int,
    val atendidos: Int,
    val tiempoMedioSegundos: Int,
    val tiempoMinimoSegundos: Int,
    val tiempoMaximoSegundos: Int,
)
