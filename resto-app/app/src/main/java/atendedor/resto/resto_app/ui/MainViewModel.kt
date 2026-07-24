package atendedor.resto.resto_app.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import atendedor.resto.resto_app.data.ManagerMobileRepository
import kotlinx.coroutines.flow.StateFlow

class MainViewModel(
    private val repository: ManagerMobileRepository,
) : ViewModel() {
    val uiState: StateFlow<MainUiState> = repository.uiState

    init {
        repository.start()
    }

    fun requestCurrentScope() {
        repository.requestCurrentScope()
    }

    fun requestHistory(fromUtc: String, toUtc: String) {
        repository.requestHistory(fromUtc, toUtc)
    }

    fun closeManagerWebSession() {
        repository.closeManagerWebSession()
    }

    override fun onCleared() {
        super.onCleared()
        repository.stop()
    }

    companion object {
        fun factory(repository: ManagerMobileRepository): ViewModelProvider.Factory {
            return object : ViewModelProvider.Factory {
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    return MainViewModel(repository) as T
                }
            }
        }
    }
}
