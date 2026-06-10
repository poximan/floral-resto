package atendedor.resto.resto_app.ui.utils

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource

sealed class UiError {
    data class Resource(@StringRes val resId: Int, val args: List<Any> = emptyList()) : UiError()
    data class Message(val message: String) : UiError()

    @Composable
    fun asString(): String {
        return when (this) {
            is Message -> message
            is Resource -> stringResource(id = resId, *args.toTypedArray())
        }
    }
}
