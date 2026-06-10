package atendedor.resto.resto_app

enum class AppPageStyle {
    Dashboard,
    Pending,
    Attended,
    Settings,
}

data class AppPage(
    val titleResId: Int,
    val style: AppPageStyle,
)
