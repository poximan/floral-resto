package atendedor.resto.resto_app.data.mobile

data class DatasetRange(
    val scopeKind: String,
    val fromUtc: String,
    val toUtc: String,
) {
    val scopeKey: String = "$scopeKind|$fromUtc|$toUtc"
}
