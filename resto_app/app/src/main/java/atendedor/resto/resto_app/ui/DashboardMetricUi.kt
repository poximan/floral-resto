package atendedor.resto.resto_app.ui

data class DashboardMetricUi(
    val cola: String,
    val pendientes: Int,
    val atendidos: Int,
    val tiempoMedioSegundos: Int,
    val tiempoMinimoSegundos: Int,
    val tiempoMaximoSegundos: Int,
)
