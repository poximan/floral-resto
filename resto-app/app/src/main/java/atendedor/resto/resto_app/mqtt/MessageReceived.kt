package atendedor.resto.resto_app.mqtt

data class MessageReceived(val topic: String, val payload: String) : MqttClientEvent
