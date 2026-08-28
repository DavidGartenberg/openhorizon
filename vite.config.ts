import { defineConfig, type Plugin } from 'vitest/config'

/** Dev middleware exposing the data server (terrain proxy + airports) on the
 *  same origin as the client, so the preview needs a single process. The
 *  standalone Express server (server/index.mjs) mounts the same handlers. */
function dataServer(): Plugin {
  return {
    name: 'openhorizon-data-server',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        import('./server/handlers.mjs')
          .then((h) => h.route(req.url ?? '', res, req.method))
          .then((handled) => {
            if (!handled) next()
          })
          .catch(next)
      })
    },
  }
}

export default defineConfig({
  plugins: [dataServer()],
  server: {
    port: 5173,
    strictPort: true,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
