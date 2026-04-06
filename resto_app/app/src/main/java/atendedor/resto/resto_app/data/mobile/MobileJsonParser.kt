package atendedor.resto.resto_app.data.mobile

import org.json.JSONArray
import org.json.JSONObject

object MobileJsonParser {
    fun parseLoginAccepted(payload: String): Boolean {
        return JSONObject(payload).optBoolean("accepted", false)
    }

    fun parseInfoMessage(payload: String): String? {
        val json = JSONObject(payload)
        return json.optString("reason").ifBlank {
            json.optString("error").ifBlank {
                null
            }
        }
    }

    fun parseDashboardMetricsFragment(payload: String): DashboardMetricsFragmentModel {
        val json = JSONObject(payload)

        return DashboardMetricsFragmentModel(
            range = parseRange(json),
            generatedAt = json.getString("generatedAt"),
            metrics = parseMetrics(json.getJSONArray("metrics")),
        )
    }

    fun parseRevenueFragment(payload: String): RevenueFragmentModel {
        val json = JSONObject(payload)

        return RevenueFragmentModel(
            range = parseRange(json),
            generatedAt = json.getString("generatedAt"),
            revenueByTable = parseRevenue(json.getJSONArray("items")),
        )
    }

    fun parseQueueFragment(payload: String): QueueFragmentModel {
        val json = JSONObject(payload)
        val queueType = json.getString("queueType")
        val status = json.optString("status").ifBlank { null }

        return QueueFragmentModel(
            range = parseRange(json),
            generatedAt = json.getString("generatedAt"),
            requestId = json.optString("requestId").ifBlank { null },
            queueType = queueType,
            status = status,
            items = parseFlatQueueItems(json.getJSONArray("items"), queueType, status),
        )
    }

    fun parseHistoryMeta(payload: String): HistoryMetaModel {
        val json = JSONObject(payload)

        return HistoryMetaModel(
            range = parseRange(json),
            generatedAt = json.getString("generatedAt"),
            requestId = json.optString("requestId").ifBlank { null },
        )
    }

    fun parseFragmentComplete(payload: String): FragmentCompleteModel {
        val json = JSONObject(payload)

        return FragmentCompleteModel(
            range = parseRange(json),
            generatedAt = json.getString("generatedAt"),
            requestId = json.optString("requestId").ifBlank { null },
            error = json.optString("error").ifBlank { null },
        )
    }

    private fun parseRange(json: JSONObject): DatasetRange {
        val scopeKind = json.optString("scope").ifBlank { "current" }

        return DatasetRange(
            scopeKind = scopeKind,
            fromUtc = json.getString("fromUtc"),
            toUtc = json.getString("toUtc"),
        )
    }

    private fun parseMetrics(items: JSONArray): List<DashboardMetricModel> {
        return buildList {
            for (index in 0 until items.length()) {
                val item = items.getJSONObject(index)
                add(
                    DashboardMetricModel(
                        cola = item.getString("cola"),
                        pendientes = item.getInt("pendientes"),
                        atendidos = item.getInt("atendidos"),
                        tiempoMedioSegundos = item.getDouble("tiempoMedioSegundos").toInt(),
                        tiempoMinimoSegundos = item.getDouble("tiempoMinimoSegundos").toInt(),
                        tiempoMaximoSegundos = item.getDouble("tiempoMaximoSegundos").toInt(),
                    )
                )
            }
        }
    }

    private fun parseRevenue(items: JSONArray): List<RevenueByTableModel> {
        return buildList {
            for (index in 0 until items.length()) {
                val item = items.getJSONObject(index)
                add(
                    RevenueByTableModel(
                        mesaNumero = item.getInt("mesaNumero"),
                        totalArsCentavos = item.getLong("totalArsCentavos"),
                    )
                )
            }
        }
    }

    private fun parseFlatQueueItems(
        items: JSONArray,
        queueType: String,
        fallbackStatus: String?,
    ): List<QueueItemModel> {
        return buildList {
            for (index in 0 until items.length()) {
                val item = items.getJSONObject(index)
                val detailJson = item.optJSONObject("detalle")?.toString() ?: "{}"
                add(
                    QueueItemModel(
                        queueType = queueType,
                        itemId = item.getLong("id"),
                        status = item.optString("estado").ifBlank { fallbackStatus ?: "pendiente" },
                        mesaNumero = item.getInt("mesaNumero"),
                        mesaSesionId = item.getLong("mesaSesionId"),
                        createdAt = item.getString("creadaEn"),
                        closedAt = item.optString("atendidaEn").ifBlank {
                            item.optString("cerradaEn").ifBlank { null }
                        },
                        actorReference = item.optString("atendidaPor").ifBlank {
                            item.optString("cerradaPor").ifBlank { null }
                        },
                        summary = item.optString("resumen").ifBlank { null },
                        totalArsCentavos = if (item.has("totalArsCentavos")) item.getLong("totalArsCentavos") else null,
                        detailJson = detailJson,
                    )
                )
            }
        }
    }
}
