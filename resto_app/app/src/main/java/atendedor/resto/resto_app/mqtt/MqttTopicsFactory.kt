package atendedor.resto.resto_app.mqtt

import atendedor.resto.resto_app.config.MqttConfig

object MqttTopicsFactory {
    fun fromConfig(config: MqttConfig): MqttTopics {
        val baseTopic = config.baseTopic.removeSuffix("/")
        val outRoot = "$baseTopic/android/out/${config.deviceId}"

        return MqttTopics(
            loginRequest = "$baseTopic/android/in/auth/login/request",
            historyRequest = "$baseTopic/android/in/history/request",
            closeWebSessionRequest = "$baseTopic/android/in/system/web-session/close/request",
            loginResponse = "$outRoot/auth/login/response",
            systemPrefix = "$outRoot/system/",
            currentDashboardMetrics = "$outRoot/current/dashboard/metrics",
            currentDashboardRevenue = "$outRoot/current/dashboard/revenue",
            currentQueuePrefix = "$outRoot/current/queue/",
            historyPrefix = "$outRoot/history/",
            subscriptions = listOf(
                "$outRoot/auth/#",
                "$outRoot/system/#",
                "$outRoot/current/dashboard/+",
                "$outRoot/current/queue/+/#",
                "$outRoot/history/+/#",
            ),
        )
    }
}
