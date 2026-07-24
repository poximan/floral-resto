package atendedor.resto.resto_app.mqtt

data class MqttTopics(
    val loginRequest: String,
    val historyRequest: String,
    val closeWebSessionRequest: String,
    val webEntrypointRequest: String,
    val loginResponse: String,
    val systemPrefix: String,
    val systemWebEntrypointCurrent: String,
    val currentDashboardMetrics: String,
    val currentDashboardRevenue: String,
    val currentQueuePrefix: String,
    val historyPrefix: String,
    val subscriptions: List<String>,
) {
    fun isLoginResponseTopic(topic: String): Boolean = topic == loginResponse

    fun isSystemTopic(topic: String): Boolean = topic.startsWith(systemPrefix)

    fun isSystemWebEntrypointTopic(topic: String): Boolean = topic == systemWebEntrypointCurrent

    fun isCurrentDashboardMetricsTopic(topic: String): Boolean = topic == currentDashboardMetrics

    fun isCurrentDashboardRevenueTopic(topic: String): Boolean = topic == currentDashboardRevenue

    fun isCurrentQueueTopic(topic: String): Boolean = topic.startsWith(currentQueuePrefix)

    fun isHistoryTopic(topic: String): Boolean = topic.startsWith(historyPrefix)
}
