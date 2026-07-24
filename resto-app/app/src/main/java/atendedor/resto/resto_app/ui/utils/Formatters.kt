package atendedor.resto.resto_app.ui.utils

import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale
import java.text.NumberFormat

object Formatters {

    fun formatMoney(arsCentavos: Long): String {
        val locale = Locale.Builder()
            .setLanguage("es")
            .setRegion("AR")
            .build()

        return NumberFormat.getCurrencyInstance(locale)
            .format(arsCentavos / 100.0)
    }

    fun itemDetailLines(detailJson: String, fallback: String): List<String> {
        return try {
            val detail = JSONObject(detailJson)
            if (detail.length() == 0) {
                return listOf(fallback)
            }

            if (detail.has("mensajes")) {
                val messages = detail.getJSONArray("mensajes")
                return buildList {
                    for (index in 0 until messages.length()) {
                        val message = messages.getJSONObject(index)
                        add("${message.optString("autorTipo")}: ${message.optString("contenido")}")
                    }
                }
            }

            if (detail.has("items")) {
                val items = detail.getJSONArray("items")
                return buildList {
                    for (index in 0 until items.length()) {
                        val item = items.getJSONObject(index)
                        add("${item.optString("titulo")} x${item.optInt("cantidad")} (${item.optString("clienteSesionId")})")
                    }
                }
            }

            jsonLines(detail)
        } catch (_: Exception) {
            listOf(fallback)
        }
    }

    private fun jsonLines(jsonObject: JSONObject): List<String> {
        val keys = jsonObject.keys()
        val lines = mutableListOf<String>()
        while (keys.hasNext()) {
            val key = keys.next()
            val value = jsonObject.get(key)
            lines.add("$key: ${jsonValueToText(value)}")
        }
        return lines
    }

    private fun jsonValueToText(value: Any?): String {
        return when (value) {
            is JSONObject -> jsonLines(value).joinToString(separator = " | ")
            is JSONArray -> buildList {
                for (index in 0 until value.length()) {
                    add(jsonValueToText(value.get(index)))
                }
            }.joinToString(separator = ", ")

            else -> value?.toString() ?: ""
        }
    }
}
