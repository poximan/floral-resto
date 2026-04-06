package atendedor.resto.resto_app.mqtt

data class AndroidHistoryRequest(
    val requestId: String,
    val deviceId: String,
    val fromUtc: String,
    val toUtc: String,
)
