import { createFileRoute } from '@tanstack/react-router'
import { apiApp } from '#/server/api/app'

const handleRequest = ({ request }: { request: Request }) => apiApp.fetch(request)

export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      GET: handleRequest,
      POST: handleRequest,
      PUT: handleRequest,
      PATCH: handleRequest,
      DELETE: handleRequest,
      OPTIONS: handleRequest,
      HEAD: handleRequest,
    },
  },
})
