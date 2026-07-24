package atendedor.resto.resto_app.mqtt

data class ErrorRaised(val message: String) : MqttClientEvent
