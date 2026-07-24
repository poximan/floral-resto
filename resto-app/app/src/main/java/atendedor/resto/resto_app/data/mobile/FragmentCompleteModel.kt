package atendedor.resto.resto_app.data.mobile

import kotlinx.serialization.Serializable

@Serializable
data class FragmentCompleteModel(
    val range: DatasetRange,
    val generatedAt: String,
    val requestId: String? = null,
    val error: String? = null,
)
