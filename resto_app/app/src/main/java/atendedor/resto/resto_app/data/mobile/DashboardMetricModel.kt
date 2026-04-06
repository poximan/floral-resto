package atendedor.resto.resto_app.data.mobile

data class DashboardMetricModel(
    val cola: String,
    val pendientes: Int,
    val atendidos: Int,
    val tiempoMedioSegundos: Int,
    val tiempoMinimoSegundos: Int,
    val tiempoMaximoSegundos: Int,
)
