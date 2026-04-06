package atendedor.resto.resto_app.mqtt

data class AndroidLoginRequest(
    val requestId: String,
    val deviceId: String,
    val username: String,
    val password: String,
)
