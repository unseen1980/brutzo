/// <reference types="vitest/config" />
import { defineConfig, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const harnessRoot = path.join(repoRoot, 'harness')

/**
 * Serves /harness/* from the repo root during `npm run dev`, so the harness
 * screen fetches the exact same manifest + WAVs that production serves at
 * https://<site>/harness/. Production layout is assembled by the deploy
 * workflow (marketing at /, app at /app/, clips at /harness/).
 */
function serveHarnessInDev(): Plugin {
  return {
    name: 'serve-harness-in-dev',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
        if (!pathname.startsWith('/harness/')) return next()
        const rel = pathname.replace(/^\/harness\//, '').replace(/\.\./g, '')
        const file = path.normalize(path.join(harnessRoot, rel))
        if (!file.startsWith(harnessRoot)) {
          res.statusCode = 403
          res.end('Forbidden')
          return
        }
        fs.readFile(file, (err, data) => {
          if (err) {
            res.statusCode = 404
            res.end('Not found')
            return
          }
          const ext = path.extname(file).toLowerCase()
          res.setHeader(
            'Content-Type',
            ext === '.json' ? 'application/json' : ext === '.wav' ? 'audio/wav' : 'application/octet-stream',
          )
          res.end(data)
        })
      })
    },
  }
}

export default defineConfig({
  /**
   * Relative assets are required: GitHub project Pages serves the app at
   * /brutzo/app/, while the future custom domain serves it at /app/.
   */
  base: './',
  plugins: [react(), serveHarnessInDev()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
