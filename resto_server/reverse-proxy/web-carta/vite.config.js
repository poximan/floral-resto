import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  base: process.env.VITE_APP_BASE_PATH || '/',
  plugins: [vue()],
  server: {
    allowedHosts: [
      'web-carta',
      '.trycloudflare.com',
      'localhost',
      '127.0.0.1',
    ],
  },
});
