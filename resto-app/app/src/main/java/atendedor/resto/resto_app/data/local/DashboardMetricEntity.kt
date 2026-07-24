package atendedor.resto.resto_app.data.local

import androidx.room.Entity

@Entity(
    tableName = "dashboard_metrics",
    primaryKeys = ["scopeKey", "cola"],
)
data class DashboardMetricEntity(
    val scopeKey: String,
    val cola: String,
    val pendientes: Int,
    val atendidos: Int,
    val tiempoMedioSegundos: Int,
    val tiempoMinimoSegundos: Int,
    val tiempoMaximoSegundos: Int,
)
