import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      // Перенаправляем запросы /api на наш бэкенд-сервер
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true, // необходимо для виртуальных хостов
      },
    }
  },
});