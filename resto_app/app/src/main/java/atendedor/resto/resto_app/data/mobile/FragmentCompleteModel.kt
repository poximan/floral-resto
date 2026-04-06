package atendedor.resto.resto_app.data.mobile

data class FragmentCompleteModel(
    val range: DatasetRange,
    val generatedAt: String,
    val requestId: String?,
    val error: String?,
)
