package atendedor.resto.resto_app.data.mobile

import kotlinx.serialization.json.Json
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonPrimitive

object MobileJsonParser {
    private val json = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
        encodeDefaults = true
    }

    fun parseLoginAccepted(payload: String): Boolean {
        return try {
            val element = json.parseToJsonElement(payload)
            element.jsonObject["accepted"]?.jsonPrimitive?.booleanOrNull ?: false
        } catch (_: Exception) {
            false
        }
    }

    fun parseInfoMessage(payload: String): String? {
        return try {
            val element = json.parseToJsonElement(payload).jsonObject
            element["reason"]?.jsonPrimitive?.content?.ifBlank { null }
                ?: element["error"]?.jsonPrimitive?.content?.ifBlank { null }
        } catch (_: Exception) {
            null
        }
    }

    fun parsePublicManagementUrl(payload: String): String? {
        return try {
            val element = json.parseToJsonElement(payload).jsonObject
            element["publicManagementUrl"]?.jsonPrimitive?.content?.ifBlank { null }
                ?: element["publicUrl"]?.jsonPrimitive?.content?.ifBlank { null }
        } catch (_: Exception) {
            null
        }
    }

    fun parseDashboardMetricsFragment(payload: String): DashboardMetricsFragmentModel {
        return json.decodeFromString(payload)
    }

    fun parseRevenueFragment(payload: String): RevenueFragmentModel {
        return json.decodeFromString(payload)
    }

    fun parseQueueFragment(payload: String): QueueFragmentModel {
        val fragment: QueueFragmentModel = json.decodeFromString(payload)
        // Inyectamos el queueType y status en los items para facilitar su persistencia
        return fragment.copy(
            items = fragment.items.map {
                it.copy(queueType = fragment.queueType, status = it.status ?: fragment.status)
            }
        )
    }

    fun parseHistoryMeta(payload: String): HistoryMetaModel {
        return json.decodeFromString(payload)
    }

    fun parseFragmentComplete(payload: String): FragmentCompleteModel {
        return json.decodeFromString(payload)
    }
}
