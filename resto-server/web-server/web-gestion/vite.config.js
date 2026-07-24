import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mesaLayoutPluginDir = process.env.VITE_MESA_LAYOUT_PLUGIN_DIR ?? '../plugin/mesa-layout';
const mesaLayoutPluginPath = path.resolve(__dirname, mesaLayoutPluginDir);

export default defineConfig({
  base: process.env.VITE_APP_BASE_PATH || '/',
  resolve: {
    alias: {
      '@mesa-layout-plugin': mesaLayoutPluginPath,
    },
  },
  plugins: [vue()],
  server: {
    allowedHosts: [
      'web-gestion',
      '.trycloudflare.com',
      'localhost',
      '127.0.0.1',
    ],
    fs: {
      allow: [
        __dirname,
        mesaLayoutPluginPath,
      ],
    },
  },
});
