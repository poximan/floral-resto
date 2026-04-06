package atendedor.resto.resto_app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val DarkColorScheme = darkColorScheme(
    primary = BarAmber,
    onPrimary = BarInk,
    primaryContainer = BarAmberDeep,
    onPrimaryContainer = BarIvory,
    secondary = BarSage,
    onSecondary = BarNight,
    secondaryContainer = BarNightSurfaceAlt,
    onSecondaryContainer = BarNightText,
    tertiary = BarClay,
    onTertiary = BarIvory,
    background = BarNight,
    onBackground = BarNightText,
    surface = BarNightSurface,
    onSurface = BarNightText,
    surfaceVariant = BarNightSurfaceAlt,
    onSurfaceVariant = BarNightTextMuted,
    outline = BarNightOutline,
    error = StatusRed,
    onError = BarIvory,
)

private val LightColorScheme = lightColorScheme(
    primary = BarAmberDeep,
    onPrimary = BarIvory,
    primaryContainer = BarAmberSoft,
    onPrimaryContainer = BarInk,
    secondary = BarSage,
    onSecondary = BarIvory,
    secondaryContainer = BarSageSoft,
    onSecondaryContainer = BarSageDeep,
    tertiary = BarClay,
    onTertiary = BarIvory,
    background = BarIvory,
    onBackground = BarInk,
    surface = Color(0xFFFFFCF8),
    onSurface = BarInk,
    surfaceVariant = BarSand,
    onSurfaceVariant = BarStone,
    outline = Color(0xFFCBBBAA),
    error = StatusRed,
    onError = BarIvory,
)

@Composable
fun Resto_appTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content
    )
}
