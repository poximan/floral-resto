package atendedor.resto.resto_app.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "cached_datasets")
data class CachedDatasetEntity(
    @PrimaryKey val scopeKey: String,
    val scopeKind: String,
    val fromUtc: String,
    val toUtc: String,
    val generatedAt: String,
    val fragmentsReadyCsv: String = "",
    val complete: Boolean = false,
)
