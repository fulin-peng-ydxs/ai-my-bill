import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { pageRegistry, pageStates } from './pageRegistry'
import { routes } from '../router'

const designPath = fileURLToPath(new URL('../../../DESIGN.md', import.meta.url))
const design = readFileSync(designPath, 'utf8')

function registeredDesignPageKeys(): string[] {
  const registrySection = design.match(/<!-- page-registry:start -->([\s\S]*?)<!-- page-registry:end -->/)?.[1] ?? ''
  return [...registrySection.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1])
}

describe('page registry contract', () => {
  it('uses the four mutually exclusive states from the requirement and DESIGN', () => {
    expect(pageStates).toEqual(['ready', 'loading', 'empty', 'error'])
  })

  it('matches the DESIGN page registry in both directions', () => {
    expect(pageRegistry.map((page) => page.pageKey).sort()).toEqual(registeredDesignPageKeys().sort())
  })

  it('maps every registration to exactly one route with matching protection metadata', () => {
    const registeredRouteRecords = routes.filter((route) => route.meta?.pageKey)
    const unregisteredProtectedRoutes = routes.filter(
      (route) => route.meta?.requiresAuthentication && !route.meta.pageKey,
    )
    expect(registeredRouteRecords).toHaveLength(pageRegistry.length)
    expect(unregisteredProtectedRoutes).toHaveLength(0)

    for (const page of pageRegistry) {
      const matchingRoutes = registeredRouteRecords.filter((route) => route.meta?.pageKey === page.pageKey)
      expect(matchingRoutes).toHaveLength(1)
      expect(matchingRoutes[0]?.path).toBe(page.path)
      expect(matchingRoutes[0]?.meta?.requiresAuthentication).toBe(page.role !== 'anonymous')
      expect(matchingRoutes[0]?.meta?.role).toBe(page.role)
    }
  })

  it('requires every page to expose the shared state contract', () => {
    for (const page of pageRegistry) {
      expect(page.states).toEqual(pageStates)
    }
  })
})
