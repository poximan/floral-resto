package atendedor.resto.resto_app.ui.screens

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import atendedor.resto.resto_app.AppPageStyle
import atendedor.resto.resto_app.R
import atendedor.resto.resto_app.ui.QueueItemUi
import atendedor.resto.resto_app.ui.utils.Formatters
import atendedor.resto.resto_app.ui.utils.UiUtils.pageAccentColor
import atendedor.resto.resto_app.ui.utils.UiUtils.pageAccentContainer
import atendedor.resto.resto_app.ui.utils.UiUtils.queueTypeLabel

@Composable
fun QueueScreen(
    titleResId: Int,
    items: List<QueueItemUi>,
    pageStyle: AppPageStyle,
) {
    var selectedItemId by rememberSaveable { mutableStateOf<Long?>(null) }
    val selectedItem = items.firstOrNull { it.itemId == selectedItemId } ?: items.firstOrNull()
    val accentColor = pageAccentColor(pageStyle)
    val accentContainer = pageAccentContainer(pageStyle)

    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Surface(
            shape = RoundedCornerShape(18.dp),
            color = MaterialTheme.colorScheme.surface,
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = stringResource(id = titleResId),
                    style = MaterialTheme.typography.titleMedium,
                    color = accentColor,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    text = stringResource(id = R.string.queue_count_label, items.size),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }

        if (items.isEmpty()) {
            Card(
                shape = RoundedCornerShape(18.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            ) {
                Text(
                    text = stringResource(id = R.string.empty_queue),
                    modifier = Modifier.padding(16.dp),
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier.weight(1f),
                contentPadding = PaddingValues(bottom = 6.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(items) { item ->
                    Card(
                        shape = RoundedCornerShape(18.dp),
                        colors = CardDefaults.cardColors(
                            containerColor = if (item.itemId == selectedItemId) {
                                accentContainer
                            } else {
                                MaterialTheme.colorScheme.surface
                            }
                        ),
                        modifier = Modifier
                            .fillMaxWidth()
                            .border(
                                width = if (item.itemId == selectedItemId) 1.5.dp else 0.dp,
                                color = if (item.itemId == selectedItemId) {
                                    accentColor.copy(alpha = 0.5f)
                                } else {
                                    MaterialTheme.colorScheme.outline.copy(alpha = 0.12f)
                                },
                                shape = RoundedCornerShape(18.dp),
                            )
                            .clickable { selectedItemId = item.itemId },
                    ) {
                        Column(
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text(
                                text = stringResource(
                                    id = R.string.queue_item_heading,
                                    queueTypeLabel(item.queueType),
                                    item.mesaNumero,
                                ),
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold,
                                color = if (item.itemId == selectedItemId) accentColor else MaterialTheme.colorScheme.onSurface,
                            )
                            item.summary?.let { summary ->
                                Text(
                                    text = stringResource(id = R.string.queue_summary_label, summary),
                                    style = MaterialTheme.typography.bodyMedium,
                                )
                            }
                            Text(
                                text = stringResource(id = R.string.queue_created_at_label, item.createdAt),
                                style = MaterialTheme.typography.bodySmall,
                            )
                            item.closedAt?.let { closedAt ->
                                Text(
                                    text = stringResource(id = R.string.queue_closed_at_label, closedAt),
                                    style = MaterialTheme.typography.bodySmall,
                                )
                            }
                        }
                    }
                }
            }
        }

        DetailCard(
            item = selectedItem,
            accentColor = accentColor,
        )
    }
}

@Composable
private fun DetailCard(
    item: QueueItemUi?,
    accentColor: Color,
) {
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface,
        ),
        border = androidx.compose.foundation.BorderStroke(
            width = 1.dp,
            color = accentColor.copy(alpha = 0.18f),
        ),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = stringResource(id = R.string.queue_detail_title),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = accentColor,
            )

            if (item == null) {
                Text(
                    text = stringResource(id = R.string.queue_detail_placeholder),
                    style = MaterialTheme.typography.bodyMedium,
                )
            } else {
                Text(
                    text = stringResource(
                        id = R.string.queue_item_heading,
                        queueTypeLabel(item.queueType),
                        item.mesaNumero,
                    ),
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Bold,
                )
                item.summary?.let { summary ->
                    Text(
                        text = stringResource(id = R.string.queue_summary_label, summary),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
                item.totalArsCentavos?.let { total ->
                    Text(
                        text = stringResource(id = R.string.queue_total_label, Formatters.formatMoney(total)),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
                item.closedAt?.let { closedAt ->
                    Text(
                        text = stringResource(id = R.string.queue_closed_at_label, closedAt),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
                item.actorReference?.let { actorReference ->
                    Text(
                        text = stringResource(id = R.string.queue_actor_label, actorReference),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
                Formatters.itemDetailLines(
                    detailJson = item.detailJson,
                    fallback = stringResource(id = R.string.queue_detail_json_fallback),
                ).forEach { line ->
                    Text(
                        text = line,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
    }
}
