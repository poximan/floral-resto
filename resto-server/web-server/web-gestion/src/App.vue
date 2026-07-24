<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import {
  MesaLayoutPlugin,
  normalizeMesaLayoutState,
} from '@mesa-layout-plugin';

const httpGwDisplayUrl = window.location.origin;
const authSession = ref(null);
const currentRole = ref(null);
const tunnelInfo = ref(null);
const queueStatus = ref('pendiente');
const mesaAdminViewMode = ref('texto');
const mesaLayoutPluginEnabled = ref(false);
const mesaLayoutState = ref(null);
const loading = ref(false);
const errorMessage = ref('');
const infoMessage = ref('');
const consultaDraft = ref('');

const loginForm = reactive({ role: 'mozo', username: '', password: '' });
const dashboard = ref(null);
const visualConfig = ref(null);
const menuImages = ref([]);
const categorias = ref([]);
const subcategorias = ref([]);
const productos = ref([]);
const mesas = ref([]);
const editingCategoryId = ref(null);
const editingProductId = ref(null);
const categoryDeleteBlockModalOpen = ref(false);
const categoryDeleteBlockTargetTitle = ref('');
const categoryDeleteBlockProducts = ref([]);
const categoryForm = reactive({ titulo: '', orden: '' });
const productForm = reactive({
  subcategoriaId: '',
  titulo: '',
  descripcion: '',
  precioArsCentavos: '',
  imagenNombreArchivo: '',
});
const mesaForm = reactive({ nombre: '' });
const configForm = reactive({ visualUsdExchangeRate: '' });
const queues = reactive({ consultas: [], pedidosCocina: [], llamadosMozo: [] });
const selectedIds = reactive({ consultas: null, pedidosCocina: null, llamadosMozo: null });
const detail = reactive({ consulta: null, pedidoCocina: null, llamadoMozo: null });
const seenIds = reactive({ consultas: new Set(), pedidosCocina: new Set(), llamadosMozo: new Set() });

let internalSocket = null;
let internalSocketClosedManually = false;
let internalSocketReconnectId = null;

const columns = computed(() => [
  {
    key: 'pedidosCocina',
    titulo: 'Pedidos para cocina',
    items: queues.pedidosCocina,
    selectedId: selectedIds.pedidosCocina,
    unseenCount: queues.pedidosCocina.filter((item) => !seenIds.pedidosCocina.has(item.id)).length,
  },
  {
    key: 'llamadosMozo',
    titulo: 'Solicita atencion presencial',
    items: queues.llamadosMozo,
    selectedId: selectedIds.llamadosMozo,
    unseenCount: queues.llamadosMozo.filter((item) => !seenIds.llamadosMozo.has(item.id)).length,
  },
  {
    key: 'consultas',
    titulo: 'Mensajes de mesas',
    items: queues.consultas,
    selectedId: selectedIds.consultas,
    unseenCount: queues.consultas.filter((item) => !seenIds.consultas.has(item.id)).length,
  },
]);

const mesaActionLabel = computed(() => {
  const mesaNombre = String(mesaForm.nombre ?? '').trim();

  if (!mesaNombre) {
    return 'Crear mesa';
  }

  return `Crear mesa ${mesaNombre}`;
});

function clearFeedback() {
  errorMessage.value = '';
  infoMessage.value = '';
}

function showError(message) {
  errorMessage.value = message;
  infoMessage.value = '';
}

function showInfo(message) {
  infoMessage.value = message;
  errorMessage.value = '';
}

function roleLabel(role) {
  if (role === 'mozo') {
    return 'Mozo';
  }

  if (role === 'encargado') {
    return 'Encargado';
  }

  return 'Interno';
}

function queueStatusLabel(status) {
  if (status === 'pendiente') {
    return 'pendientes';
  }

  if (status === 'atendido') {
    return 'atendidos';
  }

  if (status === 'cobrada') {
    return 'cobrados';
  }

  return status;
}

function dashboardMetricLabel(key) {
  const labels = {
    consultas: 'Consultas de mesas',
    pedidos_cocina: 'Pedidos para cocina',
    llamados_mozo: 'Llamados al mozo',
  };

  return labels[key] ?? key;
}

function applyMesaLayoutPluginPayload(payload) {
  if (typeof payload?.enabled !== 'boolean') {
    throw new Error('El estado del plugin de mapa de mesas es invalido');
  }

  mesaLayoutPluginEnabled.value = payload.enabled;
  mesaLayoutState.value = normalizeMesaLayoutState(payload.config);

  if (!mesaLayoutPluginEnabled.value) {
    mesaAdminViewMode.value = 'texto';
  }
}

async function setMesaLayoutPluginEnabled(enabled) {
  loading.value = true;
  clearFeedback();
  try {
    const payload = await fetchJson('/api/internal/plugins/mesa-layout/enabled', {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    });
    applyMesaLayoutPluginPayload(payload);
    showInfo(enabled ? 'El mapa grafico de mesas fue enchufado.' : 'El mapa grafico de mesas fue desenchufado.');
  } catch (error) {
    showError(error.message);
  } finally {
    loading.value = false;
  }
}

async function updateMesaLayoutState(nextState) {
  clearFeedback();
  try {
    const payload = await fetchJson('/api/internal/plugins/mesa-layout/layout', {
      method: 'PUT',
      body: JSON.stringify({
        config: normalizeMesaLayoutState(nextState),
      }),
    });
    applyMesaLayoutPluginPayload(payload);
  } catch (error) {
    showError(error.message);
  }
}

function menuAssetUrl(fileName) {
  if (!fileName) {
    return null;
  }

  return buildGatewayUrl(`/assets/menu/${encodeURIComponent(fileName)}`);
}

function buildGatewayUrl(pathname) {
  return new URL(pathname, window.location.origin).toString();
}

function buildGatewayWebSocketUrl(pathname) {
  const httpUrl = buildGatewayUrl(pathname);
  const url = new URL(httpUrl, window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function clearInternalSocketReconnect() {
  if (internalSocketReconnectId) {
    window.clearTimeout(internalSocketReconnectId);
    internalSocketReconnectId = null;
  }
}

async function parseResponsePayload(response) {
  const rawBody = await response.text();

  if (!rawBody) {
    return null;
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new Error('http-gw devolvio una respuesta invalida');
  }
}

function parseCategoryDeleteBlockProducts(message) {
  const marker = 'productos activos:';
  const normalizedMessage = message ?? '';
  const markerIndex = normalizedMessage.indexOf(marker);

  if (markerIndex < 0) {
    return [];
  }

  return normalizedMessage
    .slice(markerIndex + marker.length)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function closeCategoryDeleteBlockModal() {
  categoryDeleteBlockModalOpen.value = false;
  categoryDeleteBlockTargetTitle.value = '';
  categoryDeleteBlockProducts.value = [];
}

function resetCategoryForm() {
  editingCategoryId.value = null;
  categoryForm.titulo = '';
  categoryForm.orden = '';
}

function resetProductForm() {
  editingProductId.value = null;
  productForm.subcategoriaId = '';
  productForm.titulo = '';
  productForm.descripcion = '';
  productForm.precioArsCentavos = '';
  productForm.imagenNombreArchivo = '';
}

function clearSessionState() {
  closeInternalRealtimeChannel();
  authSession.value = null;
  currentRole.value = null;
  dashboard.value = null;
  visualConfig.value = null;
  mesaLayoutPluginEnabled.value = false;
  mesaLayoutState.value = null;
  mesaAdminViewMode.value = 'texto';
  menuImages.value = [];
  categorias.value = [];
  subcategorias.value = [];
  productos.value = [];
  mesas.value = [];
  closeCategoryDeleteBlockModal();
  editingCategoryId.value = null;
  editingProductId.value = null;
  queues.consultas = [];
  queues.pedidosCocina = [];
  queues.llamadosMozo = [];
  selectedIds.consultas = null;
  selectedIds.pedidosCocina = null;
  selectedIds.llamadosMozo = null;
  detail.consulta = null;
  detail.pedidoCocina = null;
  detail.llamadoMozo = null;
}

function handleRemoteSessionClosure(message) {
  clearSessionState();
  showError(message);
}

async function handleDomainRealtimeEvent(payload) {
  if (payload?.type === 'waiter_web_session' && payload.event === 'closed' && currentRole.value === 'mozo') {
    handleRemoteSessionClosure('La sesion del mozo fue reemplazada por otro ingreso. Puedes volver a entrar cuando quieras.');
    return;
  }

  if (payload?.type === 'manager_web_session' && payload.event === 'closed' && currentRole.value === 'encargado') {
    handleRemoteSessionClosure('La sesion interna del encargado fue cerrada y debes volver a ingresar.');
    return;
  }

  if (!authSession.value) {
    return;
  }

  try {
    if (authSession.value.role === 'mozo') {
      await Promise.all([loadQueues(), loadMesas(), loadMesaLayoutPlugin()]);
      return;
    }

    if (authSession.value.role === 'encargado') {
      await Promise.all([loadDashboard(), loadMesaLayoutPlugin()]);
    }
  } catch (error) {
    showError(error.message);
  }
}

function scheduleInternalRealtimeReconnect() {
  if (internalSocketReconnectId || internalSocketClosedManually || !authSession.value) {
    return;
  }

  internalSocketReconnectId = window.setTimeout(() => {
    internalSocketReconnectId = null;
    openInternalRealtimeChannel();
  }, 2000);
}

function closeInternalRealtimeChannel() {
  internalSocketClosedManually = true;
  clearInternalSocketReconnect();

  if (!internalSocket) {
    return;
  }

  if (internalSocket.readyState === WebSocket.OPEN || internalSocket.readyState === WebSocket.CONNECTING) {
    internalSocket.close();
  }

  internalSocket = null;
}

function openInternalRealtimeChannel() {
  if (!authSession.value) {
    return;
  }

  closeInternalRealtimeChannel();
  internalSocketClosedManually = false;

  const socket = new WebSocket(buildGatewayWebSocketUrl('/api/internal/socket'));

  internalSocket = socket;

  socket.addEventListener('message', async (event) => {
    try {
      const payload = JSON.parse(event.data);

      if (payload.type === 'ready') {
        return;
      }

      if (payload.type === 'session_error') {
        handleRemoteSessionClosure(payload.error ?? 'La sesion interna fue cerrada.');
        return;
      }

      if (payload.type === 'domain_event') {
        await handleDomainRealtimeEvent(payload.payload);
      }
    } catch (error) {
      showError(error.message);
    }
  });

  socket.addEventListener('close', () => {
    if (internalSocket === socket) {
      internalSocket = null;
    }

    if (!internalSocketClosedManually) {
      scheduleInternalRealtimeReconnect();
    }
  });

  socket.addEventListener('error', () => {
    if (!internalSocketClosedManually) {
      showError('La sincronizacion en tiempo real del panel interno se interrumpio. Se intentara reconectar.');
    }
  });
}

async function fetchTunnelInfo() {
  const response = await fetch(buildGatewayUrl('/api/internal/tunel'));
  const payload = await parseResponsePayload(response);

  if (!response.ok) {
    throw new Error(payload?.error ?? 'No se pudo consultar el tunel efimero');
  }

  return payload;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(buildGatewayUrl(url), {
    ...options,
    credentials: 'same-origin',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });
  const payload = await parseResponsePayload(response);
  const sessionErrorMessage = payload?.error ?? 'La sesion interna fue cerrada. Debes volver a ingresar.';

  if (!response.ok) {
    if (response.status === 401) {
      handleRemoteSessionClosure(sessionErrorMessage);
    }
    throw new Error(response.status === 401 ? sessionErrorMessage : payload?.error ?? 'La solicitud no pudo completarse');
  }

  return payload;
}

async function refreshSelectedWaiterDetails() {
  const detailLoaders = [];

  if (selectedIds.consultas && queues.consultas.some((item) => item.id === selectedIds.consultas)) {
    detailLoaders.push(
      fetchJson(`/api/internal/mozo/consultas/${selectedIds.consultas}`)
        .then((payload) => {
          detail.consulta = payload;
        }),
    );
  } else {
    selectedIds.consultas = null;
    detail.consulta = null;
  }

  if (selectedIds.pedidosCocina && queues.pedidosCocina.some((item) => item.id === selectedIds.pedidosCocina)) {
    detailLoaders.push(
      fetchJson(`/api/internal/mozo/pedidos-cocina/${selectedIds.pedidosCocina}`)
        .then((payload) => {
          detail.pedidoCocina = payload;
        }),
    );
  } else {
    selectedIds.pedidosCocina = null;
    detail.pedidoCocina = null;
  }

  if (selectedIds.llamadosMozo && queues.llamadosMozo.some((item) => item.id === selectedIds.llamadosMozo)) {
    detailLoaders.push(
      fetchJson(`/api/internal/mozo/llamados-mozo/${selectedIds.llamadosMozo}`)
        .then((payload) => {
          detail.llamadoMozo = payload;
        }),
    );
  } else {
    selectedIds.llamadosMozo = null;
    detail.llamadoMozo = null;
  }

  await Promise.all(detailLoaders);
}

function formatHour(value) {
  if (!value) {
    return '--:--';
  }
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function formatMoney(arsCentavos) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
  }).format(Number(arsCentavos ?? 0) / 100);
}

async function loadQueues() {
  const payload = await fetchJson(`/api/internal/mozo/queues?status=${queueStatus.value}`);
  queues.consultas = payload.consultas;
  queues.pedidosCocina = payload.pedidosCocina;
  queues.llamadosMozo = payload.llamadosMozo;
  await refreshSelectedWaiterDetails();
}

async function loadDashboard() {
  dashboard.value = await fetchJson('/api/internal/dashboard');
}

async function loadCategorias() {
  categorias.value = await fetchJson('/api/internal/categorias');
}

async function loadSubcategorias() {
  subcategorias.value = await fetchJson('/api/internal/subcategorias');
}

async function loadProductos() {
  productos.value = await fetchJson('/api/internal/productos');
}

async function loadMesas() {
  mesas.value = await fetchJson('/api/internal/mesas');
}

async function loadVisualConfig() {
  visualConfig.value = await fetchJson('/api/internal/config');
  configForm.visualUsdExchangeRate = String(visualConfig.value.visualUsdExchangeRate ?? '');
}

async function loadMesaLayoutPlugin() {
  const payload = await fetchJson('/api/internal/plugins/mesa-layout');
  applyMesaLayoutPluginPayload(payload);
}

async function loadMenuImages() {
  menuImages.value = await fetchJson('/api/internal/assets/menu-images');
}

async function loadRoleData() {
  if (!authSession.value) {
    return;
  }
  loading.value = true;
  clearFeedback();
  try {
    if (authSession.value.role === 'mozo') {
      await Promise.all([loadQueues(), loadMesas(), loadVisualConfig(), loadMesaLayoutPlugin()]);
    } else {
      await Promise.all([
        loadDashboard(),
        loadCategorias(),
        loadSubcategorias(),
        loadProductos(),
        loadMenuImages(),
        loadMesaLayoutPlugin(),
      ]);
    }
  } catch (error) {
    showError(error.message);
  } finally {
    loading.value = false;
  }
}

async function loadTunnelInfo() {
  try {
    tunnelInfo.value = await fetchTunnelInfo();
  } catch (error) {
    tunnelInfo.value = {
      ready: false,
      publicUrl: '',
      lastError: error.message,
    };
  }
}

async function copyTunnelUrl() {
  if (!tunnelInfo.value?.publicUrl) {
    return;
  }

  try {
    await navigator.clipboard.writeText(tunnelInfo.value.publicUrl);
    showInfo('La URL efimera del tunel fue copiada al portapapeles.');
  } catch {
    window.prompt('Copia manualmente la URL efimera del tunel', tunnelInfo.value.publicUrl);
  }
}

async function restoreSession() {
  try {
    const response = await fetch(buildGatewayUrl('/api/internal/auth/session'), {
      credentials: 'same-origin',
    });

    if (response.status === 401) {
      clearSessionState();
      return;
    }

    const payload = await parseResponsePayload(response);

    if (!response.ok) {
      throw new Error(payload?.error ?? 'La sesion interna no pudo restaurarse');
    }

    authSession.value = payload;
    currentRole.value = payload.role;
    await loadRoleData();
    openInternalRealtimeChannel();
  } catch (error) {
    showError(error.message);
  }
}

async function loginInternal() {
  loading.value = true;
  clearFeedback();
  try {
    const payload = await fetchJson('/api/internal/auth/login', {
      method: 'POST',
      body: JSON.stringify(loginForm),
    });
    authSession.value = payload;
    currentRole.value = payload.role;
    loginForm.password = '';
    await loadRoleData();
    openInternalRealtimeChannel();
  } catch (error) {
    showError(error.message);
  } finally {
    loading.value = false;
  }
}

async function logoutInternal() {
  loading.value = true;
  try {
    await fetchJson('/api/internal/auth/logout', { method: 'POST', body: JSON.stringify({}) });
  } catch (error) {
    showError(error.message);
  } finally {
    clearSessionState();
    loading.value = false;
  }
}

async function selectConsulta(id) {
  clearFeedback();
  selectedIds.consultas = id;
  seenIds.consultas.add(id);
  detail.consulta = await fetchJson(`/api/internal/mozo/consultas/${id}`);
}

async function selectKitchenOrder(id) {
  clearFeedback();
  selectedIds.pedidosCocina = id;
  seenIds.pedidosCocina.add(id);
  detail.pedidoCocina = await fetchJson(`/api/internal/mozo/pedidos-cocina/${id}`);
}

async function selectWaiterCall(id) {
  clearFeedback();
  selectedIds.llamadosMozo = id;
  seenIds.llamadosMozo.add(id);
  detail.llamadoMozo = await fetchJson(`/api/internal/mozo/llamados-mozo/${id}`);
}

async function sendConsultaMessage() {
  if (!detail.consulta?.id || !consultaDraft.value.trim()) {
    showError('Escribe un mensaje para responder la consulta.');
    return;
  }
  loading.value = true;
  clearFeedback();
  try {
    detail.consulta = await fetchJson(`/api/internal/mozo/consultas/${detail.consulta.id}/message`, {
      method: 'POST',
      body: JSON.stringify({ contenido: consultaDraft.value.trim() }),
    });
    consultaDraft.value = '';
    await loadQueues();
    showInfo('Mensaje enviado correctamente.');
  } catch (error) {
    showError(error.message);
  } finally {
    loading.value = false;
  }
}

async function closeConsulta() {
  if (!detail.consulta?.id) {
    return;
  }
  if (!window.confirm('La conversacion se cerrara y pasara a atendidos. Deseas continuar?')) {
    return;
  }
  loading.value = true;
  clearFeedback();
  try {
    detail.consulta = await fetchJson(`/api/internal/mozo/consultas/${detail.consulta.id}/close`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    await loadQueues();
    showInfo('La conversacion fue cerrada.');
  } catch (error) {
    showError(error.message);
  } finally {
    loading.value = false;
  }
}

async function receiveKitchenOrder() {
  if (!detail.pedidoCocina?.id) {
    return;
  }
  loading.value = true;
  clearFeedback();
  try {
    await fetchJson(`/api/internal/mozo/pedidos-cocina/${detail.pedidoCocina.id}/receive`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    detail.pedidoCocina = null;
    selectedIds.pedidosCocina = null;
    await loadQueues();
    showInfo('El pedido fue marcado como atendido.');
  } catch (error) {
    showError(error.message);
  } finally {
    loading.value = false;
  }
}

async function receiveWaiterCall() {
  if (!detail.llamadoMozo?.id) {
    return;
  }
  loading.value = true;
  clearFeedback();
  try {
    await fetchJson(`/api/internal/mozo/llamados-mozo/${detail.llamadoMozo.id}/receive`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    detail.llamadoMozo = null;
    selectedIds.llamadosMozo = null;
    await loadQueues();
    showInfo('El llamado fue marcado como atendido.');
  } catch (error) {
    showError(error.message);
  } finally {
    loading.value = false;
  }
}

async function saveVisualConfig() {
  loading.value = true;
  clearFeedback();
  try {
    visualConfig.value = await fetchJson('/api/internal/config', {
      method: 'PUT',
      body: JSON.stringify({ visualUsdExchangeRate: configForm.visualUsdExchangeRate }),
    });
    showInfo('La cotizacion visual fue actualizada.');
  } catch (error) {
    showError(error.message);
  } finally {
    loading.value = false;
  }
}

async function createCategory() {
  loading.value = true;
  clearFeedback();
  try {
    if (editingCategoryId.value) {
      await fetchJson(`/api/internal/categorias/${editingCategoryId.value}`, {
        method: 'PUT',
        body: JSON.stringify(categoryForm),
      });
      showInfo('Categoria actualizada correctamente.');
    } else {
      await fetchJson('/api/internal/categorias', {
        method: 'POST',
        body: JSON.stringify(categoryForm),
      });
      showInfo('Categoria creada correctamente.');
    }

    resetCategoryForm();
    await Promise.all([loadCategorias(), loadSubcategorias(), loadProductos()]);
  } catch (error) {
    showError(error.message);
  } finally {
    loading.value = false;
  }
}

async function editCategory(category) {
  editingCategoryId.value = category.id;
  categoryForm.titulo = category.titulo;
  categoryForm.orden = String(category.orden);
  showInfo('La categoria se cargo en el formulario para editar.');
}

async function deleteCategory(category) {
  if (!window.confirm(`Deseas eliminar la categoria ${category.titulo}?`)) {
    return;
  }
  loading.value = true;
  clearFeedback();
  closeCategoryDeleteBlockModal();
  try {
    await fetchJson(`/api/internal/categorias/${category.id}`, { method: 'DELETE' });
    if (editingCategoryId.value === category.id) {
      resetCategoryForm();
    }
    await Promise.all([loadCategorias(), loadSubcategorias(), loadProductos()]);
    showInfo('Categoria eliminada correctamente.');
  } catch (error) {
    const blockingProducts = parseCategoryDeleteBlockProducts(error.message);

    if (blockingProducts.length > 0) {
      categoryDeleteBlockTargetTitle.value = category.titulo;
      categoryDeleteBlockProducts.value = blockingProducts;
      categoryDeleteBlockModalOpen.value = true;
      return;
    }

    showError(error.message);
  } finally {
    loading.value = false;
  }
}

async function createProduct() {
  loading.value = true;
  clearFeedback();
  try {
    if (editingProductId.value) {
      const currentProduct = productos.value.find((item) => item.id === editingProductId.value);
      await fetchJson(`/api/internal/productos/${editingProductId.value}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...productForm,
          activo: currentProduct?.activo ?? true,
        }),
      });
      showInfo('Producto actualizado correctamente.');
    } else {
      await fetchJson('/api/internal/productos', {
        method: 'POST',
        body: JSON.stringify(productForm),
      });
      showInfo('Producto creado correctamente.');
    }

    resetProductForm();
    await loadProductos();
  } catch (error) {
    showError(error.message);
  } finally {
    loading.value = false;
  }
}

async function editProduct(product) {
  editingProductId.value = product.id;
  productForm.subcategoriaId = String(product.subcategoriaId);
  productForm.titulo = product.titulo;
  productForm.descripcion = product.descripcion;
  productForm.precioArsCentavos = String(product.precioArsCentavos);
  productForm.imagenNombreArchivo = product.imagenNombreArchivo ?? '';
  showInfo('El producto se cargo en el formulario para editar.');
}

async function disableProduct(product) {
  if (!window.confirm(`Deseas desactivar el producto ${product.titulo}?`)) {
    return;
  }
  loading.value = true;
  clearFeedback();
  try {
    await fetchJson(`/api/internal/productos/${product.id}`, { method: 'DELETE' });
    if (editingProductId.value === product.id) {
      resetProductForm();
    }
    await loadProductos();
    showInfo('Producto desactivado correctamente.');
  } catch (error) {
    showError(error.message);
  } finally {
    loading.value = false;
  }
}

async function createMesa() {
  loading.value = true;
  clearFeedback();
  try {
    await fetchJson('/api/internal/mesas', {
      method: 'POST',
      body: JSON.stringify({
        nombre: String(mesaForm.nombre ?? '').trim(),
      }),
    });
    mesaForm.nombre = '';
    await loadMesas();
    showInfo('Mesa creada correctamente.');
  } catch (error) {
    showError(error.message);
  } finally {
    loading.value = false;
  }
}

async function chargeKitchenOrder() {
  if (!detail.pedidoCocina?.id) {
    return;
  }
  loading.value = true;
  clearFeedback();
  try {
    await fetchJson(`/api/internal/mozo/pedidos-cocina/${detail.pedidoCocina.id}/charge`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    detail.pedidoCocina = null;
    selectedIds.pedidosCocina = null;
    await loadQueues();
    showInfo('El pedido fue marcado como cobrado.');
  } catch (error) {
    showError(error.message);
  } finally {
    loading.value = false;
  }
}

function shouldWarnBeforeClosingMesa(mesa) {
  const clientesConectados = Number(mesa.clientesConectadosCount ?? 0);
  const hasDiscardableComandas =
    Number(mesa.comandasAbiertasCount ?? 0) > 0
    || Number(mesa.comandasPendientesCount ?? 0) > 0;
  const hasUnpaidAttendedComandas = Number(mesa.comandasAtendidasCount ?? 0) > 0;

  return hasUnpaidAttendedComandas || (clientesConectados > 0 && hasDiscardableComandas);
}

function buildImpactedCloseMesaConfirmation(mesaNombre, mesa) {
  const abiertas = Number(mesa.comandasAbiertasCount ?? 0);
  const pendientes = Number(mesa.comandasPendientesCount ?? 0);
  const atendidas = Number(mesa.comandasAtendidasCount ?? 0);
  const partes = [];
  const impactos = [];

  if (abiertas > 0) {
    partes.push(`${abiertas} comanda${abiertas === 1 ? '' : 's'} abierta${abiertas === 1 ? '' : 's'}`);
  }

  if (pendientes > 0) {
    partes.push(`${pendientes} comanda${pendientes === 1 ? '' : 's'} pendiente${pendientes === 1 ? '' : 's'} sin recibir`);
  }

  if (atendidas > 0) {
    partes.push(`${atendidas} comanda${atendidas === 1 ? '' : 's'} atendida${atendidas === 1 ? '' : 's'} sin cobrar`);
  }

  if (partes.length === 0) {
    return `La mesa ${mesaNombre} tiene comandas que requieren confirmacion de cierre. Deseas continuar?`;
  }

  if (abiertas > 0 || pendientes > 0) {
    impactos.push('las abiertas o pendientes se van a descartar');
  }

  if (atendidas > 0) {
    impactos.push('las atendidas quedaran sin cobrar');
  }

  return `La mesa ${mesaNombre} tiene ${partes.join(' y ')}. Si la cerras, ${impactos.join(' y ')}. Deseas continuar?`;
}

async function requestCloseMesa(mesaNombre, confirmImpactedComandas) {
  return fetchJson(`/api/internal/mesas/${encodeURIComponent(mesaNombre)}/close`, {
    method: 'POST',
    body: JSON.stringify({
      confirmImpactedComandas,
    }),
  });
}

async function finishCloseMesaRefresh() {
  await Promise.all([loadMesas(), loadQueues()]);
  detail.consulta = null;
  detail.pedidoCocina = null;
  detail.llamadoMozo = null;
  selectedIds.consultas = null;
  selectedIds.pedidosCocina = null;
  selectedIds.llamadosMozo = null;
  showInfo('La mesa fue cerrada correctamente.');
}

async function openMesa(mesa) {
  loading.value = true;
  clearFeedback();
  try {
    await fetchJson(`/api/internal/mesas/${encodeURIComponent(mesa.nombre ?? mesa.numero)}/open`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    await Promise.all([loadMesas(), loadQueues()]);
    showInfo('La mesa fue abierta correctamente.');
  } catch (error) {
    showError(error.message);
  } finally {
    loading.value = false;
  }
}

async function closeMesa(mesa) {
  const mesaNombre = mesa.nombre ?? mesa.numero;
  const shouldConfirmImpactedComandas = shouldWarnBeforeClosingMesa(mesa);

  if (
    shouldConfirmImpactedComandas
    && !window.confirm(buildImpactedCloseMesaConfirmation(mesaNombre, mesa))
  ) {
    return;
  }

  loading.value = true;
  clearFeedback();
  try {
    await requestCloseMesa(mesaNombre, shouldConfirmImpactedComandas);
    await finishCloseMesaRefresh();
  } catch (error) {
    showError(error.message);
  } finally {
    loading.value = false;
  }
}

function useImage(imageName) {
  productForm.imagenNombreArchivo = imageName;
}

function switchStatus(status) {
  queueStatus.value = status;
  clearFeedback();
  loadQueues().catch((error) => {
    showError(error.message);
  });
}

onMounted(async () => {
  await loadTunnelInfo();
  await restoreSession();
});

onBeforeUnmount(() => {
  closeInternalRealtimeChannel();
});
</script>

<template>
  <main class="layout">
    <header class="hero">
      <div>
        <p class="eyebrow">Operacion interna</p>
        <h1>Panel unificado</h1>
        <p class="subtitle">Base administrativa y operativa para mozo y encargado.</p>
      </div>
          <article v-if="authSession && currentRole === 'mozo'" class="login-card hero-config-card">
        <span>Conversion ARS/USD</span>
        <form class="simple-form stacked-form hero-config-form" @submit.prevent="saveVisualConfig">
          <input
            v-model="configForm.visualUsdExchangeRate"
            type="number"
            min="1"
            step="0.01"
            placeholder="Pesos por 1 USD, por ejemplo 1500"
          />
          <button class="primary-button" :disabled="loading">Confirmar</button>
        </form>
      </article>
      <div class="login-card" v-if="authSession">
        <span>Sesion</span>
        <strong>{{ authSession.role }} / {{ authSession.actorNombre }}</strong>
        <span class="login-card-label-secondary">Carta online</span>
        <input
          class="readonly-url-input"
          :value="tunnelInfo?.publicUrl || 'Tunel efimero iniciando...'"
          readonly
        />
        <button
          class="ghost-button"
          type="button"
          :disabled="!tunnelInfo?.publicUrl"
          @click="copyTunnelUrl"
        >
          Copiar URL
        </button>
        <button class="ghost-button" :disabled="loading" @click="logoutInternal">Cerrar sesion</button>
      </div>
      <div class="login-card" v-else>
        <span>Canal</span>
        <strong>{{ httpGwDisplayUrl }}</strong>
        <span class="login-card-label-secondary">Carta online</span>
        <input
          class="readonly-url-input"
          :value="tunnelInfo?.publicUrl || 'Tunel efimero iniciando...'"
          readonly
        />
        <button
          class="ghost-button"
          type="button"
          :disabled="!tunnelInfo?.publicUrl"
          @click="copyTunnelUrl"
        >
          Copiar URL
        </button>
      </div>
    </header>

    <section v-if="!authSession" class="login-shell">
      <article class="login-panel">
        <h2>Ingresar</h2>
        <form class="simple-form stacked-form" @submit.prevent="loginInternal">
          <select v-model="loginForm.role">
            <option value="mozo">Mozo</option>
            <option value="encargado">Encargado</option>
          </select>
          <input v-model="loginForm.username" type="text" placeholder="Usuario" />
          <input v-model="loginForm.password" type="password" placeholder="Contrasena" />
          <button class="primary-button" :disabled="loading">Ingresar</button>
        </form>
        <p v-if="errorMessage" class="feedback feedback-error">{{ errorMessage }}</p>
      </article>
    </section>

    <section v-else class="role-shell">
      <section class="content">
        <p v-if="loading" class="feedback feedback-info">Actualizando datos internos...</p>
        <p v-if="errorMessage" class="feedback feedback-error">{{ errorMessage }}</p>
        <p v-if="infoMessage" class="feedback feedback-info">{{ infoMessage }}</p>

        <template v-if="currentRole === 'mozo'">
          <section class="panel-block">
            <div class="toolbar">
              <button class="pill" :class="{ 'pill-active': queueStatus === 'pendiente' }" @click="switchStatus('pendiente')">Pendientes</button>
              <button class="pill" :class="{ 'pill-active': queueStatus === 'atendido' }" @click="switchStatus('atendido')">Atendidos</button>
              <button class="pill" :class="{ 'pill-active': queueStatus === 'cobrada' }" @click="switchStatus('cobrada')">Cobrados</button>
            </div>
            <div class="columns">
              <article v-for="column in columns" :key="column.key" class="column-card">
                <header class="column-header">
                  <div>
                    <h2>{{ column.titulo }}</h2>
                    <p>{{ column.items.length }} {{ queueStatusLabel(queueStatus) }}</p>
                  </div>
                  <span v-if="column.unseenCount > 0" class="badge">{{ column.unseenCount }}</span>
                </header>
                <div class="queue-list">
                  <button v-for="item in column.items" :key="item.id" class="queue-item" :class="{ 'queue-item-active': item.id === column.selectedId }" @click="column.key === 'consultas' ? selectConsulta(item.id) : column.key === 'pedidosCocina' ? selectKitchenOrder(item.id) : selectWaiterCall(item.id)">
                    <strong>Mesa {{ item.mesaNumero }}</strong>
                    <span>{{ formatHour(item.creadaEn) }}</span>
                  </button>
                </div>
                <div v-if="column.key === 'consultas' && detail.consulta" class="detail">
                  <strong>Consulta mesa {{ detail.consulta.mesaNumero }}</strong>
                  <div class="chat-thread">
                    <article v-for="mensaje in detail.consulta.mensajes" :key="mensaje.id" class="chat-message" :class="{ 'chat-message-own': mensaje.autorTipo === 'mozo' }">
                      <strong>{{ mensaje.autorTipo === 'mozo' ? 'Mozo' : (mensaje.autorNombre || `Cliente ${mensaje.autorReferencia}`) }}</strong>
                      <p>{{ mensaje.contenido }}</p>
                    </article>
                  </div>
                  <div v-if="detail.consulta.estado === 'pendiente'" class="detail-compose">
                    <textarea v-model="consultaDraft" rows="3" placeholder="Responder consulta" />
                    <div class="detail-actions">
                      <button class="ghost-button" :disabled="loading" @click="closeConsulta">Cerrar conversacion</button>
                      <button class="primary-button" :disabled="loading" @click="sendConsultaMessage">Enviar</button>
                    </div>
                  </div>
                </div>
                <div v-else-if="column.key === 'pedidosCocina' && detail.pedidoCocina" class="detail">
                  <strong>Pedido mesa {{ detail.pedidoCocina.mesaNumero }}</strong>
                  <p>Total {{ formatMoney(detail.pedidoCocina.totalArsCentavos) }}</p>
                  <ul class="detail-list">
                    <li v-for="item in detail.pedidoCocina.items" :key="`${item.titulo}-${item.clienteSesionId}`">{{ item.titulo }} x{{ item.cantidad }} ({{ item.clienteNombre || item.clienteSesionId }})</li>
                  </ul>
                  <div v-if="detail.pedidoCocina.estado === 'pendiente'" class="detail-actions">
                    <button class="primary-button" :disabled="loading" @click="receiveKitchenOrder">Recibido</button>
                  </div>
                  <div v-else-if="detail.pedidoCocina.estado === 'atendida'" class="detail-actions">
                    <button class="primary-button" :disabled="loading" @click="chargeKitchenOrder">Cobrar</button>
                  </div>
                </div>
                <div v-else-if="column.key === 'llamadosMozo' && detail.llamadoMozo" class="detail">
                  <strong>Llamado mesa {{ detail.llamadoMozo.mesaNumero }}</strong>
                  <p>Generado a las {{ formatHour(detail.llamadoMozo.creadaEn) }}</p>
                  <p>Solicitado por {{ detail.llamadoMozo.clienteNombre || detail.llamadoMozo.clienteSesionId }}</p>
                  <div v-if="detail.llamadoMozo.estado === 'pendiente'" class="detail-actions">
                    <button class="primary-button" :disabled="loading" @click="receiveWaiterCall">Recibido</button>
                  </div>
                </div>
                <div v-else class="detail detail-empty">
                  <strong>Selecciona un item</strong>
                  <p>El detalle operativo de esta cola aparecera aqui cuando elijas una mesa o un evento.</p>
                </div>
              </article>
            </div>
          </section>

          <section class="panel-block">
            <article class="admin-card">
              <h2>Alta de mesas</h2>
              <p>Ingresa el nombre que identifica la mesa que queres dar de alta. No puede repetirse.</p>
              <form class="simple-form" @submit.prevent="createMesa">
                <input
                  v-model="mesaForm.nombre"
                  type="text"
                  placeholder="Nombre de mesa, por ejemplo Patio A"
                />
                <button class="primary-button" :disabled="loading">{{ mesaActionLabel }}</button>
              </form>
              <div v-if="mesaLayoutPluginEnabled" class="toolbar mesa-view-toolbar">
                <button
                  class="pill"
                  :class="{ 'pill-active': mesaAdminViewMode === 'grafico' }"
                  type="button"
                  @click="mesaAdminViewMode = 'grafico'"
                >
                  Grafico
                </button>
                <button
                  class="pill"
                  :class="{ 'pill-active': mesaAdminViewMode === 'texto' }"
                  type="button"
                  @click="mesaAdminViewMode = 'texto'"
                >
                  Texto
                </button>
              </div>
              <MesaLayoutPlugin
                v-if="mesaLayoutPluginEnabled && mesaLayoutState && mesaAdminViewMode === 'grafico'"
                :mesas="mesas"
                :layout-state="mesaLayoutState"
                :loading="loading"
                @update:layout-state="updateMesaLayoutState"
                @open-mesa="openMesa"
                @close-mesa="closeMesa"
              />
              <div v-else class="table-list table-list-mesas">
                <article v-for="mesa in mesas" :key="mesa.id" class="table-row">
                  <div>
                    <strong>Mesa {{ mesa.nombre ?? mesa.numero }}</strong>
                    <p>{{ mesa.sesionActiva ? 'Abierta' : 'Cerrada' }}</p>
                  </div>
                  <div class="row-actions">
                    <button class="ghost-button" :disabled="loading || mesa.sesionActiva" @click="openMesa(mesa)">Abrir mesa</button>
                    <button class="primary-button" :disabled="loading || !mesa.sesionActiva" @click="closeMesa(mesa)">Cerrar mesa</button>
                  </div>
                </article>
              </div>
            </article>
          </section>
        </template>

        <template v-else>
          <section class="panel-block metrics-grid">
            <article v-for="metric in dashboard?.colas ?? []" :key="metric.cola" class="metric-card">
              <p>{{ dashboardMetricLabel(metric.cola) }}</p>
              <strong>{{ metric.pendientes }} pendientes / {{ metric.atendidos }} atendidos / {{ metric.cobrados ?? 0 }} cobrados</strong>
              <span>Medio {{ Math.round(metric.tiempoMedioSegundos) }} s</span>
              <span>Min {{ Math.round(metric.tiempoMinimoSegundos) }} s</span>
              <span>Max {{ Math.round(metric.tiempoMaximoSegundos) }} s</span>
            </article>
            <article class="metric-card">
              <p>Dinero total jornada</p>
              <strong>{{ formatMoney(dashboard?.dineroTotalJornadaArsCentavos ?? 0) }}</strong>
            </article>
          </section>

          <section class="panel-block secondary-grid">
            <article class="admin-card">
              <h2>Plugins operativos</h2>
              <p>Activa capacidades opcionales para la pantalla del mozo.</p>
              <div class="table-list">
                <article class="table-row">
                  <div>
                    <strong>Mapa grafico de mesas</strong>
                    <p>{{ mesaLayoutPluginEnabled ? 'Enchufado' : 'Desenchufado' }}</p>
                  </div>
                  <div class="row-actions">
                    <button
                      class="primary-button"
                      type="button"
                      :disabled="loading || mesaLayoutPluginEnabled"
                      @click="setMesaLayoutPluginEnabled(true)"
                    >
                      Enchufar
                    </button>
                    <button
                      class="ghost-button"
                      type="button"
                      :disabled="loading || !mesaLayoutPluginEnabled"
                      @click="setMesaLayoutPluginEnabled(false)"
                    >
                      Desenchufar
                    </button>
                  </div>
                </article>
              </div>
            </article>

            <article class="admin-card">
              <h2>Categorias</h2>
              <form class="simple-form" @submit.prevent="createCategory">
                <input v-model="categoryForm.titulo" type="text" placeholder="Titulo" />
                <input v-model="categoryForm.orden" type="number" min="1" placeholder="Orden" />
                <button class="primary-button" :disabled="loading">
                  {{ editingCategoryId ? 'Guardar categoria' : 'Crear categoria' }}
                </button>
                <button
                  v-if="editingCategoryId"
                  class="ghost-button"
                  type="button"
                  :disabled="loading"
                  @click="resetCategoryForm"
                >
                  Cancelar edicion
                </button>
              </form>
              <div class="table-list">
                <article v-for="category in categorias" :key="category.id" class="table-row">
                  <div>
                    <strong>{{ category.titulo }}</strong>
                    <p>Orden {{ category.orden }}</p>
                  </div>
                  <div class="row-actions">
                    <button class="ghost-button" :disabled="loading" @click="editCategory(category)">Editar</button>
                    <button class="primary-button" :disabled="loading" @click="deleteCategory(category)">Eliminar</button>
                  </div>
                </article>
              </div>
            </article>

            <article class="admin-card">
              <h2>Productos</h2>
              <form class="simple-form stacked-form" @submit.prevent="createProduct">
                <select v-model="productForm.subcategoriaId">
                  <option disabled value="">Subcategoria</option>
                  <option
                    v-for="subcategory in subcategorias"
                    :key="subcategory.id"
                    :value="subcategory.id"
                  >
                    {{ subcategory.categoriaTitulo }} / {{ subcategory.titulo }}
                  </option>
                </select>
                <input v-model="productForm.titulo" type="text" placeholder="Titulo" />
                <textarea v-model="productForm.descripcion" rows="3" placeholder="Descripcion" />
                <input v-model="productForm.precioArsCentavos" type="number" min="1" placeholder="Precio en centavos ARS" />
                <select v-model="productForm.imagenNombreArchivo">
                  <option value="">Sin imagen</option>
                  <option v-for="image in menuImages" :key="image.nombre" :value="image.nombre">{{ image.nombre }}</option>
                </select>
                <div v-if="productForm.imagenNombreArchivo" class="selected-image-preview">
                  <img
                    :src="menuAssetUrl(productForm.imagenNombreArchivo)"
                    :alt="productForm.imagenNombreArchivo"
                    class="asset-thumb asset-thumb-large"
                  />
                  <p>{{ productForm.imagenNombreArchivo }}</p>
                </div>
                <div class="form-actions-inline">
                  <button class="primary-button" :disabled="loading">
                    {{ editingProductId ? 'Guardar producto' : 'Crear producto' }}
                  </button>
                  <button
                    v-if="editingProductId"
                    class="ghost-button"
                    type="button"
                    :disabled="loading"
                    @click="resetProductForm"
                  >
                    Cancelar edicion
                  </button>
                </div>
              </form>
              <div class="asset-grid">
                <button
                  v-for="image in menuImages"
                  :key="image.nombre"
                  class="asset-card"
                  :class="{ 'asset-card-active': productForm.imagenNombreArchivo === image.nombre }"
                  type="button"
                  @click="useImage(image.nombre)"
                >
                  <img :src="menuAssetUrl(image.nombre)" :alt="image.nombre" class="asset-thumb" />
                  <span>{{ image.nombre }}</span>
                </button>
              </div>
              <div class="table-list">
                <article v-for="product in productos" :key="product.id" class="table-row">
                  <div class="product-row-copy">
                    <img
                      v-if="product.imagenNombreArchivo"
                      :src="menuAssetUrl(product.imagenNombreArchivo)"
                      :alt="product.titulo"
                      class="asset-thumb"
                    />
                    <strong>{{ product.titulo }}</strong>
                    <p>{{ product.categoriaTitulo }} / {{ product.subcategoriaTitulo }} - {{ formatMoney(product.precioArsCentavos) }}</p>
                    <p>{{ product.activo ? 'Activo' : 'Inactivo' }}</p>
                  </div>
                  <div class="row-actions">
                    <button class="ghost-button" :disabled="loading" @click="editProduct(product)">Editar</button>
                    <button class="primary-button" :disabled="loading || !product.activo" @click="disableProduct(product)">Desactivar</button>
                  </div>
                </article>
              </div>
            </article>
          </section>

          <section class="panel-block admin-card">
            <h2>Dinero por mesa en la jornada</h2>
            <div class="table-list">
              <article v-for="item in dashboard?.dineroPorMesa ?? []" :key="item.mesaNumero" class="table-row">
                <div><strong>Mesa {{ item.mesaNumero }}</strong></div>
                <div class="row-actions"><span>{{ formatMoney(item.totalArsCentavos) }}</span></div>
              </article>
              <article v-if="!(dashboard?.dineroPorMesa?.length)" class="table-row table-row-empty">
                <div>
                  <strong>Sin mesas cerradas todavia</strong>
                  <p>La recaudacion por mesa aparecera cuando exista al menos un cierre de mesa en la jornada.</p>
                </div>
              </article>
            </div>
          </section>
        </template>
      </section>
    </section>

    <section v-if="categoryDeleteBlockModalOpen" class="admin-modal-backdrop">
      <div class="admin-modal">
        <h2>No se puede eliminar la categoria</h2>
        <p>
          La categoria <strong>{{ categoryDeleteBlockTargetTitle }}</strong> todavia tiene productos
          activos. Para continuar, primero desactiva o mueve estos items:
        </p>
        <ul class="detail-list">
          <li v-for="productTitle in categoryDeleteBlockProducts" :key="productTitle">
            {{ productTitle }}
          </li>
        </ul>
        <div class="detail-actions">
          <button class="primary-button" type="button" @click="closeCategoryDeleteBlockModal">
            Entendido
          </button>
        </div>
      </div>
    </section>
  </main>
</template>
