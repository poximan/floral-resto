package atendedor.resto.resto_app.data.local

import androidx.room.Entity

@Entity(
    tableName = "revenue_by_table",
    primaryKeys = ["scopeKey", "mesaNumero"],
)
data class RevenueByTableEntity(
    val scopeKey: String,
    val mesaNumero: Int,
    val totalArsCentavos: Long,
)
