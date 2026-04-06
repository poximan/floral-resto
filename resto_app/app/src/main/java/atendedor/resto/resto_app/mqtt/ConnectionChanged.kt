package atendedor.resto.resto_app.mqtt

data class ConnectionChanged(val online: Boolean) : MqttClientEvent
