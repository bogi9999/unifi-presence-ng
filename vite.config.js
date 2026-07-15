import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';
import { quasar } from '@quasar/vite-plugin';

module.exports = defineConfig(({ command, mode }) => {
  const isProduction = mode === 'production';
  return {
    base: isProduction ? './' : '',
    root: 'app',
    write: false,
    plugins: [vue(), quasar({ sassVariables: 'app/quasar.extras.sass', autoImportComponentCase: 'combined' })],
    build: {
      outDir: resolve(__dirname, 'build'),
      assetsDir: 'assets',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'app/build.html')
        },
        // make sure to externalize deps that shouldn't be bundled
        // into your library
        external: [],
        output: {
          // Provide global variables to use in the UMD build
          // for externalized deps
          globals: {
            vue: 'vue'
          }
        }
      }
    },
    server: {
      port: 9000,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3201',
          changeOrigin: true
        },
        '/api/socket': {
          target: 'ws://127.0.0.1:3201/',
          changeOrigin: true,
          ws: true
        }
      }
    }
  };
});
