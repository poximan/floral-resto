package atendedor.resto.resto_app.mqtt

import atendedor.resto.resto_app.config.MqttConfig
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import org.eclipse.paho.client.mqttv3.IMqttActionListener
import org.eclipse.paho.client.mqttv3.IMqttDeliveryToken
import org.eclipse.paho.client.mqttv3.MqttAsyncClient
import org.eclipse.paho.client.mqttv3.MqttCallbackExtended
import org.eclipse.paho.client.mqttv3.MqttConnectOptions
import org.eclipse.paho.client.mqttv3.MqttMessage
import org.eclipse.paho.client.mqttv3.IMqttToken
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence

class ManagerMqttClient(
    private val config: MqttConfig,
    private val topics: MqttTopics,
) {
    private var connecting = false
    private var callbackInstalled = false
    private var subscribed = false
    private val eventFlow = MutableSharedFlow<MqttClientEvent>(
        replay = 1,
        extraBufferCapacity = 32,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )

    private val client by lazy {
        MqttAsyncClient(
            "ssl://${config.host}:${config.port}",
            "${config.deviceId}-${System.currentTimeMillis()}",
            MemoryPersistence(),
        )
    }

    fun events(): SharedFlow<MqttClientEvent> = eventFlow

    fun connect() {
        if (client.isConnected || connecting) {
            return
        }

        ensureCallback()

        val options = MqttConnectOptions().apply {
            userName = config.username
            password = config.password.toCharArray()
            isAutomaticReconnect = true
            isCleanSession = true
            connectionTimeout = config.timeoutSeconds
            keepAliveInterval = config.timeoutSeconds
        }

        connecting = true
        try {
            client.connect(options, null, object : IMqttActionListener {
                override fun onSuccess(asyncActionToken: IMqttToken?) = Unit

                override fun onFailure(asyncActionToken: IMqttToken?, exception: Throwable?) {
                    connecting = false
                    eventFlow.tryEmit(
                        ErrorRaised(
                            exception?.message ?: "mqtt_connect_failed",
                        )
                    )
                }
            })
        } catch (error: Exception) {
            connecting = false
            eventFlow.tryEmit(
                ErrorRaised(
                    error.message ?: "mqtt_connect_failed",
                )
            )
        }
    }

    fun disconnect() {
        connecting = false
        subscribed = false

        if (client.isConnected) {
            try {
                client.disconnect()
            } catch (_: Exception) {
                eventFlow.tryEmit(ConnectionChanged(false))
            }
        }
    }

    fun publish(topic: String, payload: String) {
        if (!client.isConnected) {
            throw IllegalStateException("mqtt_not_connected")
        }

        try {
            client.publish(topic, payload.toByteArray(Charsets.UTF_8), 1, false)
        } catch (error: Exception) {
            throw IllegalStateException(error.message ?: "mqtt_publish_failed")
        }
    }

    private fun subscribeBaseTopics() {
        if (!client.isConnected || subscribed) {
            return
        }

        try {
            client.subscribe(
                topics.subscriptions.toTypedArray(),
                IntArray(topics.subscriptions.size) { 1 },
                null,
                object : IMqttActionListener {
                    override fun onSuccess(asyncActionToken: IMqttToken?) {
                        subscribed = true
                        eventFlow.tryEmit(ConnectionChanged(true))
                    }

                    override fun onFailure(asyncActionToken: IMqttToken?, exception: Throwable?) {
                        subscribed = false
                        eventFlow.tryEmit(
                            ErrorRaised(
                                exception?.message ?: "mqtt_subscribe_failed",
                            )
                        )
                    }
                },
            )
        } catch (error: Exception) {
            subscribed = false
            eventFlow.tryEmit(
                ErrorRaised(
                    error.message ?: "mqtt_subscribe_failed",
                )
            )
        }
    }

    private fun ensureCallback() {
        if (callbackInstalled) {
            return
        }

        client.setCallback(object : MqttCallbackExtended {
            override fun connectComplete(reconnect: Boolean, serverURI: String?) {
                connecting = false
                subscribed = false
                subscribeBaseTopics()
            }

            override fun connectionLost(cause: Throwable?) {
                connecting = false
                subscribed = false
                eventFlow.tryEmit(ConnectionChanged(false))
                eventFlow.tryEmit(
                    ErrorRaised(
                        cause?.message ?: "mqtt_connection_lost",
                    )
                )
            }

            override fun messageArrived(topic: String?, message: MqttMessage?) {
                if (topic == null || message == null) {
                    return
                }

                eventFlow.tryEmit(
                    MessageReceived(
                        topic = topic,
                        payload = message.payload.toString(Charsets.UTF_8),
                    )
                )
            }

            override fun deliveryComplete(token: IMqttDeliveryToken?) = Unit
        })

        callbackInstalled = true
    }
}
