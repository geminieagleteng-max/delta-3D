import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // 使用相對路徑，這樣部署到 GitHub Pages 時，不論倉庫名稱為何皆可正確載入資源
})

