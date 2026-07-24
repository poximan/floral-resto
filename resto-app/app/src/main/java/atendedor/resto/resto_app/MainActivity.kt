package atendedor.resto.resto_app

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryScrollableTabRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.viewmodel.compose.viewModel
import atendedor.resto.resto_app.ui.MainUiState
import atendedor.resto.resto_app.ui.MainViewModel
import atendedor.resto.resto_app.ui.components.HeaderCard
import atendedor.resto.resto_app.ui.screens.DashboardScreen
import atendedor.resto.resto_app.ui.screens.QueueScreen
import atendedor.resto.resto_app.ui.screens.SettingsScreen
import atendedor.resto.resto_app.ui.theme.Resto_appTheme
import atendedor.resto.resto_app.ui.utils.UiUtils.pageAccentColor
import atendedor.resto.resto_app.ui.utils.UiUtils.pageAccentContainer
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // La llamada a installSplashScreen DEBE ocurrir antes de super.onCreate
        installSplashScreen()
        
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            val application = application as RestoApplication
            val viewModel: MainViewModel = viewModel(
                factory = MainViewModel.factory(application.managerMobileRepository)
            )

            Resto_appTheme {
                RestoApp(viewModel = viewModel)
            }
        }
    }
}

@Composable
fun RestoApp(viewModel: MainViewModel) {
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current

    RestoAppContent(
        uiState = uiState,
        onRequestCurrent = viewModel::requestCurrentScope,
        onRequestHistory = viewModel::requestHistory,
        onCloseWebSession = viewModel::closeManagerWebSession,
        onOpenManagementWeb = { url -> openExternalUrl(context, url) },
    )
}

@Composable
private fun RestoAppContent(
    uiState: MainUiState,
    onRequestCurrent: () -> Unit,
    onRequestHistory: (String, String) -> Unit,
    onCloseWebSession: () -> Unit,
    onOpenManagementWeb: (String) -> Unit,
) {
    val pages = remember {
        listOf(
            AppPage(R.string.dashboard_tab, AppPageStyle.Dashboard),
            AppPage(R.string.pending_tab, AppPageStyle.Pending),
            AppPage(R.string.attended_tab, AppPageStyle.Attended),
            AppPage(R.string.settings_tab, AppPageStyle.Settings),
        )
    }
    val pagerState = rememberPagerState(pageCount = { pages.size })
    val coroutineScope = rememberCoroutineScope()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .systemBarsPadding()
            .background(MaterialTheme.colorScheme.background)
    ) {
        HeaderCard(
            uiState = uiState,
            onOpenManagementWeb = onOpenManagementWeb,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 10.dp)
        )

        PrimaryScrollableTabRow(
            selectedTabIndex = pagerState.currentPage,
            edgePadding = 10.dp,
            modifier = Modifier.fillMaxWidth(),
            containerColor = MaterialTheme.colorScheme.surface,
            divider = {},
        ) {
            pages.forEachIndexed { index, page ->
                val selected = pagerState.currentPage == index
                val accentColor = pageAccentColor(page.style)
                val accentContainer = pageAccentContainer(page.style)

                Tab(
                    selected = selected,
                    onClick = {
                        coroutineScope.launch {
                            pagerState.animateScrollToPage(index)
                        }
                    },
                    selectedContentColor = accentColor,
                    unselectedContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                    text = {
                        Surface(
                            shape = RoundedCornerShape(999.dp),
                            color = if (selected) accentContainer else Color.Transparent,
                            border = androidx.compose.foundation.BorderStroke(
                                width = if (selected) 1.dp else 0.dp,
                                color = if (selected) accentColor.copy(alpha = 0.45f) else Color.Transparent,
                            ),
                        ) {
                            Text(
                                text = stringResource(id = page.titleResId),
                                modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                                color = if (selected) accentColor else MaterialTheme.colorScheme.onSurfaceVariant,
                                fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                            )
                        }
                    },
                )
            }
        }

        HorizontalPager(
            state = pagerState,
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = 4.dp),
        ) { index ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 10.dp, vertical = 8.dp)
            ) {
                when (index) {
                    0 -> DashboardScreen(uiState = uiState)
                    1 -> QueueScreen(
                        titleResId = R.string.pending_title,
                        items = uiState.pendingItems,
                        pageStyle = AppPageStyle.Pending,
                    )
                    2 -> QueueScreen(
                        titleResId = R.string.attended_title,
                        items = uiState.attendedItems,
                        pageStyle = AppPageStyle.Attended,
                    )
                    else -> SettingsScreen(
                        uiState = uiState,
                        onRequestCurrent = onRequestCurrent,
                        onRequestHistory = onRequestHistory,
                        onCloseWebSession = onCloseWebSession,
                    )
                }
            }
        }
    }
}

private fun openExternalUrl(context: Context, url: String) {
    try {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
        context.startActivity(intent)
    } catch (_: Exception) {
        // Manejar caso donde no hay navegador o URL inválida
    }
}
