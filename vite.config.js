import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { getConnectableHost, normalizeLoopbackHost } from './shared/networkHosts.js'
import fs from 'node:fs'
import path from 'node:path'

function resolveBasePath(env) {
  const configuredBase = env.APP_BASE_URL || env.BASE_URL
  if (configuredBase) {
    return configuredBase.endsWith('/') ? configuredBase : `${configuredBase}/`
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))
    if (pkg.homepage) {
      const pathname = new URL(pkg.homepage).pathname || '/'
      return pathname.endsWith('/') ? pathname : `${pathname}/`
    }
  } catch {
    // Fall back to root when package metadata is unavailable.
  }

  return '/'
}

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '')

  const configuredHost = env.HOST || '0.0.0.0'
  // if the host is not a loopback address, it should be used directly. 
  // This allows the vite server to EXPOSE all interfaces when the host 
  // is set to '0.0.0.0' or '::', while still using 'localhost' for browser 
  // URLs and proxy targets.
  const host = normalizeLoopbackHost(configuredHost)
  
  const proxyHost = getConnectableHost(configuredHost)
  // TODO: Remove support for legacy PORT variables in all locations in a future major release, leaving only SERVER_PORT.
  const serverPort = env.SERVER_PORT || env.PORT || 3001
  const base = resolveBasePath(env)
  const hmrPath = `${base}__vite_ws`
  const packageJson = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

  return {
    base,
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': path.resolve(process.cwd(), 'shared')
      }
    },
    define: {
      __APP_VERSION__: JSON.stringify(packageJson.version)
    },
    server: {
      host,
      port: parseInt(env.VITE_PORT) || 5173,
      allowedHosts: ['auto.huibanxue.com'],
      hmr: {
        path: hmrPath
      },
      proxy: {
        '/api': `http://${proxyHost}:${serverPort}`,
        '/ws': {
          target: `ws://${proxyHost}:${serverPort}`,
          ws: true
        },
        '/shell': {
          target: `ws://${proxyHost}:${serverPort}`,
          ws: true
        }
      }
    },
    build: {
      outDir: 'dist',
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-codemirror': [
              '@uiw/react-codemirror',
              '@codemirror/lang-css',
              '@codemirror/lang-html',
              '@codemirror/lang-javascript',
              '@codemirror/lang-json',
              '@codemirror/lang-markdown',
              '@codemirror/lang-python',
              '@codemirror/theme-one-dark'
            ],
            'vendor-xterm': ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-clipboard', '@xterm/addon-webgl']
          }
        }
      }
    }
  }
})
