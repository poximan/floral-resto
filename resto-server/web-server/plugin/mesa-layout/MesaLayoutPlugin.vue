<script setup>
import { computed, ref, watch } from 'vue';

const props = defineProps({
  mesas: {
    type: Array,
    default: () => [],
  },
  layoutState: {
    type: Object,
    required: true,
  },
  loading: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits([
  'update:layoutState',
  'openMesa',
  'closeMesa',
]);

const selectedMesaId = ref(null);
const selectedUnplacedMesaId = ref('');

const salon = computed(() => props.layoutState?.salon ?? {});
const stageWidth = computed(() => Number(salon.value.width ?? 920));
const stageHeight = computed(() => Number(salon.value.height ?? 520));
const gridSize = computed(() => Number(salon.value.gridSize ?? 40));
const layoutMesas = computed(() => Array.isArray(props.layoutState?.mesas) ? props.layoutState.mesas : []);
const mesasById = computed(() => new Map(props.mesas.map((mesa) => [Number(mesa.id), mesa])));
const placedMesaIds = computed(() => new Set(layoutMesas.value.map((mesa) => Number(mesa.mesaId))));

const visibleMesas = computed(() =>
  layoutMesas.value
    .map((layoutMesa) => ({
      ...layoutMesa,
      mesa: mesasById.value.get(Number(layoutMesa.mesaId)),
    }))
    .filter((item) => item.mesa),
);

const unplacedMesas = computed(() =>
  props.mesas.filter((mesa) => !placedMesaIds.value.has(Number(mesa.id))),
);

const selectedVisualMesa = computed(() =>
  visibleMesas.value.find((item) => Number(item.mesaId) === Number(selectedMesaId.value)) ?? null,
);

const verticalGridLines = computed(() => {
  const lines = [];
  for (let x = 0; x <= stageWidth.value; x += gridSize.value) {
    lines.push({ id: `v-${x}`, points: [x, 0, x, stageHeight.value] });
  }
  return lines;
});

const horizontalGridLines = computed(() => {
  const lines = [];
  for (let y = 0; y <= stageHeight.value; y += gridSize.value) {
    lines.push({ id: `h-${y}`, points: [0, y, stageWidth.value, y] });
  }
  return lines;
});

watch(unplacedMesas, (nextMesas) => {
  if (!nextMesas.some((mesa) => Number(mesa.id) === Number(selectedUnplacedMesaId.value))) {
    selectedUnplacedMesaId.value = nextMesas[0]?.id ? String(nextMesas[0].id) : '';
  }
}, { immediate: true });

watch(visibleMesas, (nextMesas) => {
  if (selectedMesaId.value && !nextMesas.some((item) => Number(item.mesaId) === Number(selectedMesaId.value))) {
    selectedMesaId.value = null;
  }
}, { immediate: true });

function emitLayout(nextMesas) {
  emit('update:layoutState', {
    ...props.layoutState,
    mesas: nextMesas,
  });
}

function selectMesa(mesaId) {
  selectedMesaId.value = Number(mesaId);
}

function addSelectedMesa() {
  const mesaId = Number(selectedUnplacedMesaId.value);
  const mesa = props.mesas.find((item) => Number(item.id) === mesaId);

  if (!mesa || placedMesaIds.value.has(mesaId)) {
    return;
  }

  const index = layoutMesas.value.length;
  const x = 40 + ((index * 132) % Math.max(132, stageWidth.value - 150));
  const y = 40 + (Math.floor((index * 132) / Math.max(132, stageWidth.value - 150)) * 100);
  const nextMesa = {
    mesaId,
    x,
    y: Math.min(y, stageHeight.value - 96),
    width: 116,
    height: 76,
    rotation: 0,
  };

  emitLayout([...layoutMesas.value, nextMesa]);
  selectedMesaId.value = mesaId;
}

function removeSelectedMesa() {
  if (!selectedMesaId.value) {
    return;
  }

  emitLayout(layoutMesas.value.filter((mesa) => Number(mesa.mesaId) !== Number(selectedMesaId.value)));
  selectedMesaId.value = null;
}

function updateMesaPosition(mesaId, event) {
  const node = event.target;
  emitLayout(layoutMesas.value.map((mesa) => (
    Number(mesa.mesaId) === Number(mesaId)
      ? {
          ...mesa,
          x: Math.round(node.x()),
          y: Math.round(node.y()),
        }
      : mesa
  )));
}

function mesaDragBound(item, position) {
  return {
    x: Math.min(Math.max(position.x, 0), Math.max(0, stageWidth.value - Number(item.width))),
    y: Math.min(Math.max(position.y, 0), Math.max(0, stageHeight.value - Number(item.height))),
  };
}

function resetLayout() {
  emitLayout([]);
  selectedMesaId.value = null;
}

function mesaFill(mesa) {
  if (mesa.sesionActiva) {
    return '#245d45';
  }

  return '#f8fcfa';
}

function mesaStroke(item) {
  return Number(item.mesaId) === Number(selectedMesaId.value) ? '#bf5b3d' : '#9ab9a8';
}

function mesaTextFill(mesa) {
  return mesa.sesionActiva ? '#ffffff' : '#173428';
}
</script>

<template>
  <div class="mesa-layout-plugin">
    <div class="mesa-layout-toolbar">
      <select v-model="selectedUnplacedMesaId" :disabled="loading || unplacedMesas.length === 0">
        <option value="">Mesa sin ubicar</option>
        <option v-for="mesa in unplacedMesas" :key="mesa.id" :value="mesa.id">
          Mesa {{ mesa.nombre ?? mesa.numero }}
        </option>
      </select>
      <button class="ghost-button" type="button" :disabled="loading || !selectedUnplacedMesaId" @click="addSelectedMesa">
        Agregar al mapa
      </button>
      <button class="ghost-button" type="button" :disabled="loading || !selectedMesaId" @click="removeSelectedMesa">
        Quitar del mapa
      </button>
      <button class="ghost-button" type="button" :disabled="loading || layoutMesas.length === 0" @click="resetLayout">
        Limpiar mapa
      </button>
    </div>

    <div class="mesa-layout-body">
      <div class="mesa-layout-stage-wrap">
        <v-stage :config="{ width: stageWidth, height: stageHeight }">
          <v-layer>
            <v-rect
              :config="{
                x: 0,
                y: 0,
                width: stageWidth,
                height: stageHeight,
                fill: '#f8fcfa',
                stroke: '#b8d0c2',
                strokeWidth: 2,
                cornerRadius: 10,
              }"
            />
            <v-line
              v-for="line in verticalGridLines"
              :key="line.id"
              :config="{ points: line.points, stroke: '#dcebe4', strokeWidth: 1 }"
            />
            <v-line
              v-for="line in horizontalGridLines"
              :key="line.id"
              :config="{ points: line.points, stroke: '#dcebe4', strokeWidth: 1 }"
            />
            <v-group
              v-for="item in visibleMesas"
              :key="item.mesaId"
              :config="{
                x: item.x,
                y: item.y,
                rotation: item.rotation,
                draggable: true,
                dragBoundFunc: (position) => mesaDragBound(item, position),
              }"
              @click="selectMesa(item.mesaId)"
              @tap="selectMesa(item.mesaId)"
              @dragend="updateMesaPosition(item.mesaId, $event)"
            >
              <v-rect
                :config="{
                  width: item.width,
                  height: item.height,
                  fill: mesaFill(item.mesa),
                  stroke: mesaStroke(item),
                  strokeWidth: Number(item.mesaId) === Number(selectedMesaId) ? 4 : 2,
                  cornerRadius: 12,
                  shadowColor: 'rgba(20, 37, 29, 0.18)',
                  shadowBlur: 12,
                  shadowOffsetY: 6,
                }"
              />
              <v-text
                :config="{
                  text: `Mesa ${item.mesa.nombre ?? item.mesa.numero}`,
                  x: 10,
                  y: 14,
                  width: item.width - 20,
                  align: 'center',
                  fontSize: 15,
                  fontStyle: 'bold',
                  fill: mesaTextFill(item.mesa),
                }"
              />
              <v-text
                :config="{
                  text: item.mesa.sesionActiva ? 'Abierta' : 'Cerrada',
                  x: 10,
                  y: 42,
                  width: item.width - 20,
                  align: 'center',
                  fontSize: 13,
                  fill: mesaTextFill(item.mesa),
                }"
              />
            </v-group>
          </v-layer>
        </v-stage>
      </div>

      <aside class="mesa-layout-side">
        <template v-if="selectedVisualMesa">
          <strong>Mesa {{ selectedVisualMesa.mesa.nombre ?? selectedVisualMesa.mesa.numero }}</strong>
          <p>{{ selectedVisualMesa.mesa.sesionActiva ? 'Abierta' : 'Cerrada' }}</p>
          <div class="row-actions">
            <button
              class="ghost-button"
              type="button"
              :disabled="loading || selectedVisualMesa.mesa.sesionActiva"
              @click="emit('openMesa', selectedVisualMesa.mesa)"
            >
              Abrir mesa
            </button>
            <button
              class="primary-button"
              type="button"
              :disabled="loading || !selectedVisualMesa.mesa.sesionActiva"
              @click="emit('closeMesa', selectedVisualMesa.mesa)"
            >
              Cerrar mesa
            </button>
          </div>
        </template>
        <template v-else>
          <strong>Mapa del salon</strong>
          <p>Selecciona una mesa del plano para operar o arrastrala para reubicarla.</p>
        </template>
        <p>{{ visibleMesas.length }} ubicadas / {{ mesas.length }} mesas</p>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.mesa-layout-plugin {
  display: grid;
  gap: 14px;
}

.mesa-layout-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.mesa-layout-toolbar select {
  min-width: 220px;
  border: 1px solid rgba(20, 37, 29, 0.12);
  border-radius: 18px;
  padding: 10px 14px;
  background: #fff;
  color: #14251d;
  font: inherit;
}

.mesa-layout-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 240px;
  gap: 14px;
  align-items: start;
}

.mesa-layout-stage-wrap {
  overflow: auto;
  padding: 10px;
  border-radius: 18px;
  background: #edf5f1;
  border: 1px solid rgba(20, 37, 29, 0.08);
}

.mesa-layout-side {
  display: grid;
  gap: 10px;
  padding: 14px;
  border-radius: 18px;
  background: #f8fcfa;
  border: 1px solid rgba(20, 37, 29, 0.08);
}

.mesa-layout-side p {
  color: #4a5f54;
}

@media (max-width: 860px) {
  .mesa-layout-body {
    grid-template-columns: 1fr;
  }
}
</style>
