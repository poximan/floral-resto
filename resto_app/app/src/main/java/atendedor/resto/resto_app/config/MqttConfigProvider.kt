package atendedor.resto.resto_app.config

import atendedor.resto.resto_app.BuildConfig

object MqttConfigProvider {
    fun load(): MqttConfig {
        return MqttConfig(
            host = BuildConfig.MQTT_HOST,
            port = BuildConfig.MQTT_PORT,
            username = BuildConfig.MQTT_USERNAME,
            password = BuildConfig.MQTT_PASSWORD,
            baseTopic = BuildConfig.MQTT_BASE_TOPIC,
            timeoutSeconds = BuildConfig.MQTT_TIMEOUT_SECONDS,
            deviceId = BuildConfig.MQTT_DEVICE_ID,
            managerUsername = BuildConfig.MANAGER_USERNAME,
            managerPassword = BuildConfig.MANAGER_PASSWORD,
        )
    }
}
