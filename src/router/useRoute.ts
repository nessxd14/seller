import { useEffect, useState } from 'react'
import { getPathname, subscribe } from './history'
import { parseRoute, type AppRoute } from './appRoute'

export const useRoute = (): AppRoute => {
  const [route, setRoute] = useState<AppRoute>(() => parseRoute(getPathname()))
  useEffect(() => subscribe(() => setRoute(parseRoute(getPathname()))), [])
  return route
}
