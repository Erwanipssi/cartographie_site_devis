import { createRecipientSchema } from '@cartographie/shared'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { ApiError } from '../lib/http'
import { prisma } from '../lib/prisma'

export async function registerRecipients(app: FastifyInstance): Promise<void> {
  const route = app.withTypeProvider<ZodTypeProvider>()

  route.get('/api/recipients', async () => {
    const recipients = await prisma.recipient.findMany({ orderBy: { email: 'asc' } })
    return { recipients }
  })

  route.post('/api/recipients', { schema: { body: createRecipientSchema } }, async (request, reply) => {
    try {
      const recipient = await prisma.recipient.create({
        data: {
          email: request.body.email.trim().toLowerCase(),
          label: request.body.label?.trim() || null,
        },
      })
      return reply.code(201).send({ recipient })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError(409, 'Ce destinataire existe déjà', 'DUPLICATE')
      }
      throw error
    }
  })

  route.delete('/api/recipients/:id', { schema: { params: z.object({ id: z.string().min(1) }) } }, async (request) => {
    const recipient = await prisma.recipient.findUnique({ where: { id: request.params.id } })
    if (!recipient) throw new ApiError(404, 'Destinataire introuvable', 'NOT_FOUND')
    await prisma.recipient.delete({ where: { id: recipient.id } })
    return { ok: true }
  })

  route.get('/api/mail-deliveries', { schema: { querystring: z.object({ analysisId: z.string().optional() }) } }, async (request) => {
    const deliveries = await prisma.mailDelivery.findMany({
      where: request.query.analysisId ? { analysisId: request.query.analysisId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return { deliveries }
  })
}
