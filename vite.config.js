import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/hokada/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['hokada-icon.svg'],
      manifest: {
        id: '/hokada/',
        name: 'HOKADA',
        short_name: 'HOKADA',
        description: 'Fast and reliable dispatch delivery across Lagos.',
        theme_color: '#071b12',
        background_color: '#071b12',
        display: 'standalone',
        start_url: '/hokada/',
        scope: '/hokada/',
        icons: [
          {
            src: 'hokada-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any'
          },
          {
            src: 'hokada-icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'hokada-icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          }
        ]
      }
    })
  ]
})
