import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Закреплённый порт PMS-фронта: на него указывают SSO-ссылки диспетчерской
    // Kars Avia (HOTEL_PMS_WEB_URL). strictPort — лучше упасть, чем молча
    // уехать на соседний порт и сломать ссылки.
    port: 5273,
    strictPort: true,
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
})
