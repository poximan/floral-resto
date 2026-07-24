package atendedor.resto.resto_app.config

data class MqttConfig(
    val host: String,
    val port: Int,
    val username: String,
    val password: String,
    val baseTopic: String,
    val timeoutSeconds: Int,
    val deviceId: String,
    val managerUsername: String,
    val managerPassword: String,
)
