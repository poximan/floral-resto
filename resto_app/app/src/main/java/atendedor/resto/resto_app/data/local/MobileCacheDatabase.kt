package atendedor.resto.resto_app.data.local

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [
        CachedDatasetEntity::class,
        DashboardMetricEntity::class,
        RevenueByTableEntity::class,
        QueueItemEntity::class,
    ],
    version = 2,
    exportSchema = false,
)
abstract class MobileCacheDatabase : RoomDatabase() {
    abstract fun mobileCacheDao(): MobileCacheDao
}
