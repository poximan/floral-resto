package atendedor.resto.resto_app.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface MobileCacheDao {
    @Query("SELECT * FROM cached_datasets WHERE scopeKey = :scopeKey LIMIT 1")
    suspend fun getDataset(scopeKey: String): CachedDatasetEntity?

    @Query(
        """
        SELECT * FROM cached_datasets
        WHERE scopeKind = :scopeKind
          AND fromUtc = :fromUtc
          AND toUtc = :toUtc
        LIMIT 1
        """
    )
    suspend fun getDatasetByRange(scopeKind: String, fromUtc: String, toUtc: String): CachedDatasetEntity?

    @Query(
        """
        SELECT * FROM cached_datasets
        WHERE scopeKind = :scopeKind
        ORDER BY generatedAt DESC
        LIMIT 1
        """
    )
    suspend fun getLatestDatasetByKind(scopeKind: String): CachedDatasetEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertDataset(dataset: CachedDatasetEntity)

    @Query("DELETE FROM dashboard_metrics WHERE scopeKey = :scopeKey")
    suspend fun deleteMetrics(scopeKey: String)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMetrics(items: List<DashboardMetricEntity>)

    @Query("SELECT * FROM dashboard_metrics WHERE scopeKey = :scopeKey ORDER BY cola ASC")
    suspend fun getMetrics(scopeKey: String): List<DashboardMetricEntity>

    @Query("DELETE FROM revenue_by_table WHERE scopeKey = :scopeKey")
    suspend fun deleteRevenue(scopeKey: String)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertRevenue(items: List<RevenueByTableEntity>)

    @Query("SELECT * FROM revenue_by_table WHERE scopeKey = :scopeKey ORDER BY mesaNumero ASC")
    suspend fun getRevenue(scopeKey: String): List<RevenueByTableEntity>

    @Query("DELETE FROM queue_items WHERE scopeKey = :scopeKey")
    suspend fun deleteQueueItems(scopeKey: String)

    @Query(
        """
        DELETE FROM queue_items
        WHERE scopeKey = :scopeKey
          AND queueType = :queueType
        """
    )
    suspend fun deleteQueueItemsByType(scopeKey: String, queueType: String)

    @Query(
        """
        DELETE FROM queue_items
        WHERE scopeKey = :scopeKey
          AND queueType = :queueType
          AND status = :status
        """
    )
    suspend fun deleteQueueItemsByTypeAndStatus(scopeKey: String, queueType: String, status: String)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertQueueItems(items: List<QueueItemEntity>)

    @Query(
        """
        SELECT * FROM queue_items
        WHERE scopeKey = :scopeKey
          AND status = :status
        ORDER BY createdAt ASC
        """
    )
    suspend fun getQueueItems(scopeKey: String, status: String): List<QueueItemEntity>
}
