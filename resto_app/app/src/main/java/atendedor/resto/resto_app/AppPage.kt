package atendedor.resto.resto_app

internal enum class AppPageStyle {
    Dashboard,
    Pending,
    Attended,
    Settings,
}

internal data class AppPage(
    val titleResId: Int,
    val style: AppPageStyle,
)
