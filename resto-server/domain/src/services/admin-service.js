import { createCatalogAdminService } from './catalog-admin-service.js';
import { createMesaAdminService } from './mesa-admin-service.js';
import { createDashboardAdminService } from './dashboard-admin-service.js';
import { createVisualConfigService } from './visual-config-service.js';
import { createPluginConfigService } from './plugin-config-service.js';

export function createAdminService(pool, config, recordAuditEvent, publishDomainEvent) {
  const catalogAdminService = createCatalogAdminService(pool, recordAuditEvent, publishDomainEvent);
  const mesaAdminService = createMesaAdminService(pool, recordAuditEvent, publishDomainEvent);
  const dashboardAdminService = createDashboardAdminService(pool, config);
  const visualConfigService = createVisualConfigService(pool, recordAuditEvent, publishDomainEvent);
  const pluginConfigService = createPluginConfigService(pool, recordAuditEvent, publishDomainEvent);

  return {
    listCategories: () => catalogAdminService.listCategories(),
    listSubcategories: () => catalogAdminService.listSubcategories(),
    createCategory: (payload, actorNombre) => catalogAdminService.createCategory(payload, actorNombre),
    updateCategory: (categoryId, payload, actorNombre) => catalogAdminService.updateCategory(categoryId, payload, actorNombre),
    deleteCategory: (categoryId, actorNombre) => catalogAdminService.deleteCategory(categoryId, actorNombre),
    listProducts: () => catalogAdminService.listProducts(),
    createProduct: (payload, actorNombre) => catalogAdminService.createProduct(payload, actorNombre),
    updateProduct: (productId, payload, actorNombre) => catalogAdminService.updateProduct(productId, payload, actorNombre),
    disableProduct: (productId, actorNombre) => catalogAdminService.disableProduct(productId, actorNombre),
    listMesas: () => mesaAdminService.listMesas(),
    createMesa: (payload, actorNombre) => mesaAdminService.createMesa(payload, actorNombre),
    openMesa: (mesaNumero, actorNombre) => mesaAdminService.openMesa(mesaNumero, actorNombre),
    closeMesa: (mesaNumero, actorNombre, options) => mesaAdminService.closeMesa(mesaNumero, actorNombre, options),
    getDashboard: () => dashboardAdminService.getDashboard(),
    getMobileSnapshot: () => dashboardAdminService.getMobileSnapshot(),
    getMobileCurrentDashboardMetrics: () => dashboardAdminService.getMobileCurrentDashboardMetrics(),
    getMobileCurrentDashboardRevenue: () => dashboardAdminService.getMobileCurrentDashboardRevenue(),
    getMobileCurrentQueueFragment: (status, queueType) => dashboardAdminService.getMobileCurrentQueueFragment(status, queueType),
    getHistoryDataset: (payload) => dashboardAdminService.getHistoryDataset(payload),
    getVisualConfig: () => visualConfigService.getVisualConfig(),
    updateVisualConfig: (payload, actorNombre) => visualConfigService.updateVisualConfig(payload, actorNombre),
    getMesaLayoutPlugin: () => pluginConfigService.getMesaLayoutPlugin(),
    updateMesaLayoutPluginEnabled: (enabled, actorNombre) =>
      pluginConfigService.updateMesaLayoutPluginEnabled(enabled, actorNombre),
    updateMesaLayoutPluginConfig: (config, actorNombre) =>
      pluginConfigService.updateMesaLayoutPluginConfig(config, actorNombre),
  };
}
