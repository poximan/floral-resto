package atendedor.resto.resto_app

import android.app.Application
import atendedor.resto.resto_app.config.MqttConfigProvider
import atendedor.resto.resto_app.data.ManagerMobileRepository

class RestoApplication : Application() {
    val managerMobileRepository: ManagerMobileRepository by lazy {
        ManagerMobileRepository(
            context = applicationContext,
            config = MqttConfigProvider.load(),
        )
    }
}
