import { Elysia } from 'elysia'
import { sql } from 'drizzle-orm'
import { db } from '#/server/db/connection'
import { getDirections } from '#/server/directions/service'

export const apiApp = new Elysia({ prefix: '/api' })
  .get('/', () => ({ message: 'Elysia API ready' }))
  .get('/health/db', async () => {
    const result = await db.execute<{ ok: number }>(sql`select 1 as ok`)
    const row = result[0]

    return {
      ok: row?.ok === 1,
    }
  })
  .post('/directions', async ({ body, set }) => {
    const payload =
      body && typeof body === 'object' ? (body as Record<string, unknown>) : null
    const startInput = typeof payload?.startInput === 'string' ? payload.startInput.trim() : ''
    const destinationInput =
      typeof payload?.destinationInput === 'string' ? payload.destinationInput.trim() : ''

    if (!startInput || !destinationInput) {
      set.status = 400
      return {
        error: {
          code: 'BAD_REQUEST',
          message: 'startInput and destinationInput are required.',
        },
      }
    }

    try {
      return await getDirections({ startInput, destinationInput })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Directions service is temporarily unavailable.'
      const isUserError =
        message.includes('Could not resolve') ||
        message.includes('No drivable route found') ||
        message.includes('No nearby vertex found')

      set.status = isUserError ? 422 : 500
      return {
        error: {
          code: isUserError ? 'ROUTE_NOT_AVAILABLE' : 'DIRECTIONS_SERVICE_ERROR',
          message,
        },
      }
    }
  })
