<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

const bootstrap = ref(null);
const categorias = ref([]);
const mesaState = ref(null);
const mesaNumero = ref('');
const mesaNumeroInput = ref('');
const clientNameInput = ref('');
const clientSessionId = ref('');
const splashVisible = ref(true);
const selectedTab = ref('menu');
const selectedCurrency = ref('ARS');
const loading = ref(false);
const errorMessage = ref('');
const infoMessage = ref('');
const warningMessage = ref('');
const mesaClosedMessage = ref('');
const toastMessage = ref('');
const consultModalOpen = ref(false);
const consultTargetTitle = ref('');
const consultDraft = ref('');
const consultaMessageDraft = ref('');

let realtimeSocket = null;
let reconnectTimeoutId = null;
let realtimeClosedManually = false;
let toastTimeoutId = null;

const hasMesa = computed(() => mesaNumero.value !== '');
const isLeader = computed(() => mesaState.value?.isLeader === true);
const canConfirmOrder = computed(() => mesaState.value?.canConfirmOrder === true);
const confirmedOrdersCount = computed(() => mesaState.value?.totalPedidosConfirmados ?? 0);
const visualUsdExchangeRate = computed(() => mesaState.value?.visualUsdExchangeRate ?? 0);
const hasPendingWaiterCall = computed(() => mesaState.value?.llamadoMozoPendiente !== null);
const activeConsulta = computed(() => mesaState.value?.consultaActiva ?? null);
const restaurantLogoUrl = '/restaurant-logo.svg';

function menuAssetUrl(fileName) {
  if (!fileName) {
    return null;
  }

  return buildGatewayUrl(`/assets/menu/${encodeURIComponent(fileName)}`);
}

function buildGatewayUrl(pathname) {
  return pathname;
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

function getStorageKey(numeroMesa) {
  return `restobar_client_session_${numeroMesa}`;
}

function mesaPathSegment() {
  return encodeURIComponent(mesaNumero.value);
}

function mesaPathSegmentFor(numeroMesa) {
  return encodeURIComponent(String(numeroMesa));
}

function getMesaNumeroFromLocation() {
  const currentUrl = new URL(window.location.href);
  return currentUrl.searchParams.get('mesa');
}

function getCartaPathnameForCurrentContext() {
  const currentPathname = window.location.pathname || '/';

  if (currentPathname === '/carta') {
    return '/carta';
  }

  return '/';
}

function formatMoney(arsCentavos) {
  const arsValue = Number(arsCentavos ?? 0) / 100;

  if (selectedCurrency.value === 'USD' && visualUsdExchangeRate.value > 0) {
    const usdValue = arsValue / visualUsdExchangeRate.value;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(usdValue);
  }

  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
  }).format(arsValue);
}

function syncMenuCountersWithState() {
  const quantityByProductId = new Map(
    (mesaState.value?.carritoPendiente?.items ?? []).map((item) => [item.productoId, item.cantidadTotal]),
  );

  categorias.value = categorias.value.map((categoria) => ({
    ...categoria,
    productos: categoria.productos.map((producto) => ({
      ...producto,
      cantidadTotalMesa: quantityByProductId.get(producto.id) ?? 0,
    })),
  }));
}

function buildRemovedProductsMessage(removedProducts) {
  if (!Array.isArray(removedProducts) || removedProducts.length === 0) {
    return '';
  }

  const titles = removedProducts
    .map((item) => item.titulo)
    .filter((value, index, list) => value && list.indexOf(value) === index);

  if (titles.length === 0) {
    return 'Uno o mas productos fueron retirados del menu y se eliminaron de tu pedido.';
  }

  return `Se retiraron del menu y se eliminaron de tu pedido: ${titles.join(', ')}.`;
}

function showToast(message) {
  toastMessage.value = message;

  if (toastTimeoutId) {
    clearTimeout(toastTimeoutId);
  }

  toastTimeoutId = setTimeout(() => {
    toastMessage.value = '';
    toastTimeoutId = null;
  }, 2600);
}

async function applyMesaState(nextState, options = {}) {
  const previousCatalogRevision = mesaState.value?.catalogoRevision ?? null;
  mesaState.value = nextState;
  syncMenuCountersWithState();

  const removedProductsMessage = buildRemovedProductsMessage(nextState?.productosRemovidosDelCarrito ?? []);
  if (removedProductsMessage) {
    warningMessage.value = removedProductsMessage;
  }

  const shouldRefreshMenu = options.forceRefreshMenu === true
    || categorias.value.length === 0
    || (
      previousCatalogRevision !== null
      && previousCatalogRevision !== nextState?.catalogoRevision
    );

  if (shouldRefreshMenu) {
    await refreshMenu();
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(buildGatewayUrl(url), {
    headers: {
      'Content-Type': 'application/json',
    },
    ...options,
  });
  const payload = await parseResponsePayload(response);

  if (!response.ok) {
    throw new Error(payload?.error ?? 'La solicitud no pudo completarse');
  }

  return payload;
}

async function refreshMenu() {
  const payload = await fetchJson(
    `/api/public/mesas/${mesaPathSegment()}/menu?clientSessionId=${encodeURIComponent(clientSessionId.value)}`,
  );

  categorias.value = payload.categorias;
  syncMenuCountersWithState();
}

function buildGatewayWebSocketUrl(pathname) {
  const url = new URL(pathname, window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function clearReconnectTimeout() {
  if (reconnectTimeoutId) {
    clearTimeout(reconnectTimeoutId);
    reconnectTimeoutId = null;
  }
}

function closeRealtimeChannel() {
  realtimeClosedManually = true;
  clearReconnectTimeout();

  if (!realtimeSocket) {
    return;
  }

  if (realtimeSocket.readyState === WebSocket.OPEN || realtimeSocket.readyState === WebSocket.CONNECTING) {
    realtimeSocket.close();
  }

  realtimeSocket = null;
}

function scheduleRealtimeReconnect() {
  if (reconnectTimeoutId || !mesaNumero.value || !clientSessionId.value || mesaClosedMessage.value) {
    return;
  }

  reconnectTimeoutId = setTimeout(() => {
    reconnectTimeoutId = null;
    openMesaRealtimeChannel();
  }, 2000);
}

function openMesaRealtimeChannel() {
  closeRealtimeChannel();
  realtimeClosedManually = false;

  const socket = new WebSocket(
    buildGatewayWebSocketUrl(
      `/api/public/mesas/${mesaPathSegment()}/socket?clientSessionId=${encodeURIComponent(clientSessionId.value)}`,
    ),
  );

  realtimeSocket = socket;

  socket.addEventListener('message', async (event) => {
    try {
      const payload = JSON.parse(event.data);

      if (payload.type === 'ready' || payload.type === 'keepalive') {
        return;
      }

      if (payload.type === 'mesa_state') {
        await applyMesaState(payload.payload, { forceRefreshMenu: true });
        return;
      }

      if (payload.type === 'session_error') {
        if (payload.error?.includes('no tiene una sesion activa')) {
          mesaClosedMessage.value = 'La mesa fue cerrada por el mozo. Puedes volver a ingresar si deseas iniciar una nueva sesion.';
          warningMessage.value = '';
          closeRealtimeChannel();
          return;
        }

        errorMessage.value = payload.error ?? 'La carta perdio la sincronizacion en tiempo real.';
      }
    } catch (error) {
      errorMessage.value = error.message;
    }
  });

  socket.addEventListener('close', () => {
    if (realtimeSocket === socket) {
      realtimeSocket = null;
    }

    if (!realtimeClosedManually && !mesaClosedMessage.value) {
      scheduleRealtimeReconnect();
    }
  });

  socket.addEventListener('error', () => {
    if (!mesaClosedMessage.value) {
      errorMessage.value = 'La carta perdio la conexion en tiempo real. Se intentara reconectar.';
    }
  });
}

function updateCurrentMesaInUrl(numeroMesa) {
  const url = new URL(window.location.href);
  url.pathname = getCartaPathnameForCurrentContext();
  url.searchParams.set('mesa', String(numeroMesa));
  window.history.replaceState({}, '', url);
}

async function requestMesaSession(numeroMesa) {
  const storedClientSessionId = sessionStorage.getItem(getStorageKey(numeroMesa)) ?? '';

  return fetchJson(`/api/public/mesas/${mesaPathSegmentFor(numeroMesa)}/session`, {
    method: 'POST',
    body: JSON.stringify({
      clientSessionId: storedClientSessionId || null,
      clientName: clientNameInput.value,
    }),
  });
}

async function hydrateMesaSession(numeroMesa, payload) {
  mesaNumero.value = String(numeroMesa);
  mesaNumeroInput.value = String(numeroMesa);
  clientSessionId.value = payload.clientSessionId;
  clientNameInput.value = payload.clientName ?? payload.state?.clientName ?? clientNameInput.value;
  categorias.value = payload.menu;
  await applyMesaState(payload.state);
  selectedTab.value = 'menu';

  sessionStorage.setItem(getStorageKey(numeroMesa), payload.clientSessionId);
  mesaClosedMessage.value = '';
  updateCurrentMesaInUrl(numeroMesa);
  openMesaRealtimeChannel();
}

function isRecoverableMesaSessionError(message) {
  const normalizedMessage = String(message ?? '');

  return normalizedMessage.includes('La sesion del cliente no pertenece a la mesa activa')
    || normalizedMessage.includes('Falta clientSessionId')
    || normalizedMessage.includes('La mesa fue cerrada por el mozo');
}

async function recoverMesaSession() {
  if (!mesaNumero.value) {
    throw new Error('No hay una mesa activa para recuperar la sesion.');
  }

  const payload = await requestMesaSession(mesaNumero.value);
  await hydrateMesaSession(mesaNumero.value, payload);
}

async function startMesaSession(numeroMesa) {
  loading.value = true;
  errorMessage.value = '';
  infoMessage.value = '';
  warningMessage.value = '';

  try {
    const payload = await requestMesaSession(numeroMesa);
    await hydrateMesaSession(numeroMesa, payload);
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    loading.value = false;
  }
}

function resetMesaFlow() {
  closeRealtimeChannel();
  mesaClosedMessage.value = '';
  errorMessage.value = '';
  infoMessage.value = '';
  warningMessage.value = '';
  selectedTab.value = 'menu';
  mesaState.value = null;
  categorias.value = [];
  clientSessionId.value = '';
  mesaNumero.value = '';
  clientNameInput.value = '';

  const url = new URL(window.location.href);
  url.pathname = getCartaPathnameForCurrentContext();
  url.searchParams.delete('mesa');
  window.history.replaceState({}, '', url);
}

async function closeCarta() {
  if (!mesaNumero.value || !clientSessionId.value) {
    resetMesaFlow();
    return;
  }

  const mesaActual = mesaNumero.value;
  loading.value = true;
  errorMessage.value = '';

  try {
    await fetchJson(`/api/public/mesas/${mesaPathSegment()}/disconnect`, {
      method: 'POST',
      body: JSON.stringify({
        clientSessionId: clientSessionId.value,
        immediate: true,
      }),
    });
    sessionStorage.removeItem(getStorageKey(mesaActual));
    resetMesaFlow();
    mesaNumeroInput.value = '';
    infoMessage.value = 'Carta cerrada.';
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    loading.value = false;
  }
}

async function submitMesaNumber() {
  const numeroMesa = String(mesaNumeroInput.value ?? '').trim();

  if (!numeroMesa) {
    errorMessage.value = 'Ingresa un nombre de mesa valido.';
    return;
  }

  await startMesaSession(numeroMesa);
}

async function updateCart(productoId, action) {
  loading.value = true;
  errorMessage.value = '';
  warningMessage.value = '';
  infoMessage.value = '';

  try {
    let payload;

    try {
      payload = await fetchJson(`/api/public/mesas/${mesaPathSegment()}/cart/items`, {
        method: 'POST',
        body: JSON.stringify({
          clientSessionId: clientSessionId.value,
          productoId,
          action,
        }),
      });
    } catch (error) {
      if (!isRecoverableMesaSessionError(error.message)) {
        throw error;
      }

      await recoverMesaSession();
      payload = await fetchJson(`/api/public/mesas/${mesaPathSegment()}/cart/items`, {
        method: 'POST',
        body: JSON.stringify({
          clientSessionId: clientSessionId.value,
          productoId,
          action,
        }),
      });
    }

    categorias.value = payload.menu;
    await applyMesaState(payload.state);
  } catch (error) {
    if (action === 'remove' && error.message.includes('Solo puedes descartar productos de tu propiedad')) {
      showToast('Solo puedes descartar productos propios o heredados.');
    } else {
      errorMessage.value = error.message;
    }
  } finally {
    loading.value = false;
  }
}

async function confirmOrder() {
  loading.value = true;
  errorMessage.value = '';
  warningMessage.value = '';
  infoMessage.value = '';

  try {
    const payload = await fetchJson(`/api/public/mesas/${mesaPathSegment()}/order/confirm`, {
      method: 'POST',
      body: JSON.stringify({
        clientSessionId: clientSessionId.value,
      }),
    });

    categorias.value = payload.menu;
    await applyMesaState(payload.state);
    infoMessage.value = 'El pedido se confirmo correctamente.';
    selectedTab.value = 'estado';
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    loading.value = false;
  }
}

function openConsultModal(productTitle) {
  if (activeConsulta.value) {
    errorMessage.value = 'La mesa ya tiene una consulta abierta.';
    selectedTab.value = 'estado';
    return;
  }

  consultTargetTitle.value = productTitle;
  consultDraft.value = '';
  consultModalOpen.value = true;
}

function closeConsultModal() {
  consultModalOpen.value = false;
  consultTargetTitle.value = '';
  consultDraft.value = '';
}

async function submitConsulta() {
  if (!consultDraft.value.trim()) {
    errorMessage.value = 'Escribe el contenido de la consulta.';
    return;
  }

  loading.value = true;
  errorMessage.value = '';
  warningMessage.value = '';
  infoMessage.value = '';

  try {
    const payload = await fetchJson(`/api/public/mesas/${mesaPathSegment()}/consulta/open`, {
      method: 'POST',
      body: JSON.stringify({
        clientSessionId: clientSessionId.value,
        contenido: `${consultTargetTitle.value}: ${consultDraft.value.trim()}`,
      }),
    });

    await applyMesaState(payload);
    selectedTab.value = 'estado';
    closeConsultModal();
    infoMessage.value = 'La consulta se abrio correctamente.';
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    loading.value = false;
  }
}

async function sendConsultaMessage() {
  if (!consultaMessageDraft.value.trim()) {
    errorMessage.value = 'Escribe un mensaje antes de enviarlo.';
    return;
  }

  loading.value = true;
  errorMessage.value = '';
  warningMessage.value = '';
  infoMessage.value = '';

  try {
    const payload = await fetchJson(`/api/public/mesas/${mesaPathSegment()}/consulta/message`, {
      method: 'POST',
      body: JSON.stringify({
        clientSessionId: clientSessionId.value,
        contenido: consultaMessageDraft.value.trim(),
      }),
    });

    await applyMesaState(payload);
    consultaMessageDraft.value = '';
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    loading.value = false;
  }
}

async function closeConsulta() {
  if (!window.confirm('La conversacion se cerrara y no aceptara mas mensajes. Deseas continuar?')) {
    return;
  }

  loading.value = true;
  errorMessage.value = '';
  warningMessage.value = '';
  infoMessage.value = '';

  try {
    const payload = await fetchJson(`/api/public/mesas/${mesaPathSegment()}/consulta/close`, {
      method: 'POST',
      body: JSON.stringify({
        clientSessionId: clientSessionId.value,
      }),
    });

    await applyMesaState(payload);
    consultaMessageDraft.value = '';
    infoMessage.value = 'La conversacion fue cerrada.';
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    loading.value = false;
  }
}

async function callWaiter() {
  loading.value = true;
  errorMessage.value = '';
  warningMessage.value = '';
  infoMessage.value = '';

  try {
    const payload = await fetchJson(`/api/public/mesas/${mesaPathSegment()}/waiter-call`, {
      method: 'POST',
      body: JSON.stringify({
        clientSessionId: clientSessionId.value,
      }),
    });

    await applyMesaState(payload);
    infoMessage.value = 'Se notifico un pedido de atencion presencial para tu mesa.';
    selectedTab.value = 'estado';
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    loading.value = false;
  }
}

function chooseCurrency(currency) {
  selectedCurrency.value = currency;
}

onMounted(async () => {
  window.setTimeout(() => {
    splashVisible.value = false;
  }, 2000);

  bootstrap.value = await fetchJson('/api/public/bootstrap');

  const mesaParam = getMesaNumeroFromLocation();

  if (mesaParam) {
    mesaNumeroInput.value = mesaParam;
    await startMesaSession(mesaParam);
  }
});

onBeforeUnmount(() => {
  closeRealtimeChannel();
  clearReconnectTimeout();

  if (toastTimeoutId) {
    clearTimeout(toastTimeoutId);
    toastTimeoutId = null;
  }
});
</script>

<template>
  <section v-if="splashVisible" class="splash-screen">
    <img :src="restaurantLogoUrl" alt="Logo del restaurante" class="splash-logo" />
  </section>

  <main v-else class="layout">
    <header class="hero">
      <div>
        <p class="eyebrow">{{ hasMesa ? `Mesa ${mesaNumero}` : 'Ingreso de mesa' }}</p>
        <h1>Carta digital</h1>
        <p class="subtitle">
          {{ hasMesa ? 'Explora la carta, arma el pedido compartido de la mesa y consulta al mozo si lo necesitas.' : 'Escanea, ingresa el nombre de mesa y empieza a pedir.' }}
        </p>
      </div>
      <div v-if="!hasMesa" class="hero-card">
        <span>Bienvenido</span>
        <strong>{{ bootstrap?.businessName || 'Carta online' }}</strong>
        <small>Ingresa tu mesa para ver la carta compartida.</small>
      </div>
    </header>

    <section v-if="!hasMesa" class="mesa-form">
      <h2>Bienvenido</h2>
      <p>Indica el nombre de mesa para cargar la carta compartida.</p>
      <p v-if="errorMessage" class="feedback feedback-error">{{ errorMessage }}</p>
      <p v-if="warningMessage" class="feedback feedback-warning">{{ warningMessage }}</p>
      <p v-if="infoMessage" class="feedback feedback-info">{{ infoMessage }}</p>
      <div class="mesa-form-row">
        <input v-model="mesaNumeroInput" type="text" placeholder="Mesa, barra o sector" />
        <input v-model="clientNameInput" type="text" placeholder="Tu nombre (opcional)" />
        <button class="primary-button" :disabled="loading" @click="submitMesaNumber">
          Ingresar
        </button>
      </div>
    </section>

    <template v-else-if="!mesaClosedMessage">
      <section class="tabs">
        <button
          class="tab"
          :class="{ 'tab-active': selectedTab === 'menu' }"
          @click="selectedTab = 'menu'"
        >
          Menu
        </button>
        <button
          class="tab"
          :class="{ 'tab-active': selectedTab === 'estado' }"
          @click="selectedTab = 'estado'"
        >
          Estado del pedido
        </button>
      </section>

      <section class="currency-toggle">
        <button
          class="tab"
          :class="{ 'tab-active': selectedCurrency === 'ARS' }"
          @click="chooseCurrency('ARS')"
        >
          ARS
        </button>
        <button
          class="tab"
          :class="{ 'tab-active': selectedCurrency === 'USD' }"
          @click="chooseCurrency('USD')"
        >
          USD
        </button>
      </section>

      <section class="session-banner" :class="{ 'session-banner-leader': isLeader }">
        <strong v-if="isLeader">Tu dispositivo confirma el pedido de la mesa.</strong>
        <strong v-else>Otra persona de la mesa confirma el pedido.</strong>
        <p>
          {{ isLeader ? 'Puedes seguir cargando items y confirmar el carrito pendiente cada vez que la mesa lo necesite.' : 'Puedes sumar o quitar items, pero la confirmacion final la hace quien lidera la mesa.' }}
        </p>
      </section>

      <p v-if="errorMessage" class="feedback feedback-error">{{ errorMessage }}</p>
      <p v-if="warningMessage" class="feedback feedback-warning">{{ warningMessage }}</p>
      <p v-if="infoMessage" class="feedback feedback-info">{{ infoMessage }}</p>

      <section v-if="selectedTab === 'menu'" class="catalog">
        <article v-for="categoria in categorias" :key="categoria.id" class="category">
          <header class="category-header">
            <h2>{{ categoria.titulo }}</h2>
          </header>
          <div class="category-body">
            <div v-for="producto in categoria.productos" :key="producto.id" class="product">
              <div class="product-actions">
                <strong>{{ formatMoney(producto.precioArsCentavos) }}</strong>
                <button
                  class="ghost-button"
                  :disabled="loading || !!activeConsulta"
                  @click="openConsultModal(producto.titulo)"
                >
                  Consultar
                </button>
                <div class="counter">
                  <button
                    v-if="producto.cantidadTotalMesa > 0"
                    class="ghost-button"
                    :disabled="loading"
                    @click="updateCart(producto.id, 'remove')"
                  >
                    Descartar
                  </button>
                  <span>{{ producto.cantidadTotalMesa ?? 0 }}</span>
                  <button
                    class="primary-button"
                    :disabled="loading"
                    @click="updateCart(producto.id, 'add')"
                  >
                    Pedir
                  </button>
                </div>
              </div>
              <div class="product-copy">
                <h3>{{ producto.titulo }}</h3>
                <p>{{ producto.descripcion }}</p>
              </div>
              <img
                v-if="producto.imagenNombreArchivo"
                :src="menuAssetUrl(producto.imagenNombreArchivo)"
                :alt="producto.titulo"
                class="product-image"
                loading="lazy"
              />
            </div>
          </div>
        </article>
      </section>

      <section v-else class="state-card">
        <h2>Estado actual de la mesa</h2>
        <p><strong>Confirmacion:</strong> {{ isLeader ? 'La haces desde este dispositivo' : 'La hace otra persona de la mesa' }}</p>
        <p><strong>Pedidos enviados:</strong> {{ confirmedOrdersCount }}</p>
        <p>
          <strong>Llamado a mozo:</strong>
          {{ mesaState?.llamadoMozoPendiente ? 'Pendiente' : 'Sin llamado pendiente' }}
        </p>
        <p>
          <strong>Consulta:</strong>
          {{ mesaState?.consultaPendiente ? 'Pendiente' : 'Sin consulta abierta' }}
        </p>

        <section v-if="activeConsulta" class="consulta-panel">
          <h3>Conversacion abierta</h3>
          <div class="consulta-thread">
            <article
              v-for="mensaje in activeConsulta.mensajes"
              :key="mensaje.id"
              class="consulta-message"
              :class="{ 'consulta-message-own': mensaje.autorTipo === 'cliente' }"
            >
              <strong>{{ mensaje.autorTipo === 'cliente' ? (mensaje.autorNombre || 'Cliente') : 'Mozo' }}</strong>
              <p>{{ mensaje.contenido }}</p>
            </article>
          </div>
          <div class="consulta-compose">
            <textarea
              v-model="consultaMessageDraft"
              rows="3"
              placeholder="Escribe un mensaje para el mozo"
            />
            <div class="consulta-actions">
              <button class="ghost-button" :disabled="loading" @click="closeConsulta">
                Cerrar conversacion
              </button>
              <button class="primary-button" :disabled="loading" @click="sendConsultaMessage">
                Enviar mensaje
              </button>
            </div>
          </div>
        </section>

        <h3>Carrito pendiente</h3>
        <div class="state-items">
          <article
            v-for="item in mesaState?.pedidoActual?.items ?? []"
            :key="item.productoId"
            class="state-item"
          >
            <div>
              <strong>{{ item.titulo }}</strong>
              <p>{{ item.descripcion }}</p>
            </div>
            <span>x{{ item.cantidadTotal }}</span>
          </article>
          <article v-if="!(mesaState?.pedidoActual?.items?.length)" class="state-item">
            <div>
              <strong>Sin items pendientes</strong>
              <p>Cuando agreguen productos al carrito compartido apareceran aqui hasta que el lider confirme el siguiente pedido.</p>
            </div>
          </article>
        </div>

        <p class="state-total">
          Total pendiente: {{ formatMoney(mesaState?.pedidoActual?.totalArsCentavos ?? 0) }}
        </p>

        <section v-if="mesaState?.pedidosConfirmados?.length" class="confirmed-orders">
          <h3>Pedidos ya enviados</h3>
          <article
            v-for="pedido in mesaState?.pedidosConfirmados ?? []"
            :key="pedido.id"
            class="confirmed-order-card"
          >
            <header class="confirmed-order-header">
              <strong>Pedido {{ pedido.numeroOrden }}</strong>
              <span>{{ new Date(pedido.confirmadoEn).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }) }}</span>
            </header>
            <div class="state-items">
              <article
                v-for="item in pedido.items"
                :key="`${pedido.id}-${item.productoId}`"
                class="state-item"
              >
                <div>
                  <strong>{{ item.titulo }}</strong>
                  <p>{{ item.descripcion }}</p>
                </div>
                <span>x{{ item.cantidadTotal }}</span>
              </article>
            </div>
            <p class="state-total">
              Total enviado: {{ formatMoney(pedido.totalArsCentavos) }}
            </p>
          </article>
        </section>
      </section>

      <footer class="sticky-footer">
        <button
          class="ghost-button close-carta-button"
          :disabled="loading"
          @click="closeCarta"
        >
          Cerrar carta
        </button>
        <button
          class="ghost-button"
          :class="{ 'calling-waiter-button': hasPendingWaiterCall }"
          :disabled="loading || hasPendingWaiterCall"
          @click="callWaiter"
        >
          {{ hasPendingWaiterCall ? 'llamando a mozo, aguarde por favor' : 'Llamar mozo' }}
        </button>
        <button
          v-if="isLeader"
          class="primary-button"
          :disabled="loading || !canConfirmOrder"
          @click="confirmOrder"
        >
          Confirmar
        </button>
      </footer>
    </template>

    <section v-else class="state-card">
      <h2>Mesa cerrada</h2>
      <p>{{ mesaClosedMessage }}</p>
      <div class="consult-modal-actions">
        <button class="ghost-button" @click="resetMesaFlow">Ingresar nuevamente</button>
      </div>
    </section>

    <section v-if="consultModalOpen" class="consult-modal-backdrop">
      <div class="consult-modal">
        <h2>Nueva consulta</h2>
        <p>Producto: {{ consultTargetTitle }}</p>
        <textarea
          v-model="consultDraft"
          rows="4"
          placeholder="Escribe la consulta que vera el mozo"
        />
        <div class="consult-modal-actions">
          <button class="ghost-button" :disabled="loading" @click="closeConsultModal">
            Cancelar
          </button>
          <button class="primary-button" :disabled="loading" @click="submitConsulta">
            Abrir consulta
          </button>
        </div>
      </div>
    </section>

    <transition name="toast-fade">
      <div v-if="toastMessage" class="toast-message">
        {{ toastMessage }}
      </div>
    </transition>
  </main>
</template>
