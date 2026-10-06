import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { test } from 'node:test'

const apiSourcePath = fileURLToPath(import.meta.url)
const apiSource = readFileSync(resolve(dirname(apiSourcePath), 'index.ts'), 'utf8')
const backendSource = readFileSync(resolve(dirname(apiSourcePath), '../../../backend/src/main.rs'), 'utf8')

function normalizeRoute(route: string): string {
  return route
    .replace(/^\/api/, '')
    .replace(/\$\{[^}]+\}/g, '{id}')
    .replace(/([^/])\{id\}$/, '$1')
    .split('?')[0]
    .replace(/\/$/, '') || '/'
}

function extractBackendRoutes(source: string): Set<string> {
  return new Set([...source.matchAll(/\.route\(\s*"([^"]+)"/g)].map(match => normalizeRoute(match[1])))
}

function extractFrontendRoutes(source: string): Set<string> {
  const routes = new Set<string>()
  const routePattern = /(['"`])(\/[^'"`\r\n]+)\1/g
  for (const match of source.matchAll(routePattern)) routes.add(normalizeRoute(match[2]))
  return routes
}

void test('frontend API wrappers cover every backend route', () => {
  const backendRoutes = extractBackendRoutes(backendSource)
  const frontendRoutes = extractFrontendRoutes(apiSource)
  const missing = [...backendRoutes].filter(route => !frontendRoutes.has(route))
  assert.deepEqual(missing, [], `backend routes missing from frontend API: ${missing.join(', ')}`)
  assert.ok(frontendRoutes.has('/diagnostics'))
  assert.ok(frontendRoutes.has('/diagnostics/log'))
})
