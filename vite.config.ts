import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ command }) => {
  const connectSource = command === 'serve'
    ? "'self' ws://127.0.0.1:5173"
    : "'none'";
  return {
    base: './',
    plugins: [
      tailwindcss(),
      react(),
      {
        name: 'builder-content-security-policy',
        transformIndexHtml(html) {
          return html.replace('__BUILDER_CONNECT_SRC__', connectSource);
        },
      },
    ],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
    },
  };
});
