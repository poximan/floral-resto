package atendedor.resto.resto_app.ui.utils

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import atendedor.resto.resto_app.AppPageStyle
import atendedor.resto.resto_app.R
import atendedor.resto.resto_app.ui.theme.BarClay
import atendedor.resto.resto_app.ui.theme.BarNightSurfaceAlt
import atendedor.resto.resto_app.ui.theme.BarRoseSoft

object UiUtils {

    @Composable
    fun queueTypeLabel(queueType: String): String {
        return when (queueType) {
            "consultas" -> stringResource(id = R.string.queue_type_consultas)
            "pedidos_cocina", "pedidosCocina" -> stringResource(id = R.string.queue_type_pedidos)
            "llamados_mozo", "llamadosMozo" -> stringResource(id = R.string.queue_type_llamados)
            else -> queueType
        }
    }

    @Composable
    fun pageAccentColor(style: AppPageStyle): Color {
        return when (style) {
            AppPageStyle.Dashboard -> MaterialTheme.colorScheme.primary
            AppPageStyle.Pending -> MaterialTheme.colorScheme.primary
            AppPageStyle.Attended -> MaterialTheme.colorScheme.primary
            AppPageStyle.Settings -> BarClay
        }
    }

    @Composable
    fun pageAccentContainer(style: AppPageStyle): Color {
        val darkTheme = isSystemInDarkTheme()

        return when (style) {
            AppPageStyle.Dashboard -> dashboardAccentContainer(darkTheme)
            AppPageStyle.Pending -> dashboardAccentContainer(darkTheme)
            AppPageStyle.Attended -> dashboardAccentContainer(darkTheme)
            AppPageStyle.Settings -> if (darkTheme) BarNightSurfaceAlt else BarRoseSoft
        }
    }

    @Composable
    private fun dashboardAccentContainer(darkTheme: Boolean): Color {
        return MaterialTheme.colorScheme.primary.copy(alpha = if (darkTheme) 0.24f else 0.14f)
    }
}
