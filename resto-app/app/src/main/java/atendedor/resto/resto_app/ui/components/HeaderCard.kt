package atendedor.resto.resto_app.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import atendedor.resto.resto_app.BuildConfig
import atendedor.resto.resto_app.R
import atendedor.resto.resto_app.ui.MainUiState

@Composable
fun HeaderCard(
    uiState: MainUiState,
    onOpenManagementWeb: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val businessName = remember { BuildConfig.BUSINESS_NAME }
    val managementUrl = uiState.publicManagementUrl

    Card(
        modifier = modifier,
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface,
        ),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = businessName,
                    style = MaterialTheme.typography.headlineSmall,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.weight(1f),
                )
                Button(
                    enabled = !managementUrl.isNullOrBlank(),
                    onClick = {
                        managementUrl?.let(onOpenManagementWeb)
                    },
                ) {
                    Text(text = stringResource(id = R.string.open_management_web))
                }
            }
            Text(
                text = stringResource(id = R.string.manager_mobile_subtitle),
                style = MaterialTheme.typography.labelLarge,
            )
        }
    }
}
