import nodemailer from 'nodemailer'
import { env, smtpConfigured } from '../../env'
import { prisma } from '../../lib/prisma'
import { analysisSummaryText, loadAnalysisExport } from '../exporter/export-analysis'

export async function sendReport(input: { analysisId: string; emails: string[]; trigger: string }): Promise<void> {
  const delivery = await prisma.mailDelivery.create({
    data: {
      analysisId: input.analysisId,
      recipients: input.emails,
      status: 'pending',
      trigger: input.trigger,
    },
  })
  try {
    if (!smtpConfigured) throw new Error('SMTP non configuré')
    if (input.emails.length === 0) throw new Error('Aucun destinataire')
    const buffer = await loadAnalysisExport(input.analysisId)
    const text = await analysisSummaryText(input.analysisId)
    const transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE === 'true',
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
    await transport.sendMail({
      from: env.MAIL_FROM,
      to: input.emails,
      subject: `Cartographie — rapport ${input.analysisId.slice(0, 8)}`,
      text,
      attachments: [
        {
          filename: `cartographie-${input.analysisId.slice(0, 8)}.xlsx`,
          content: buffer,
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      ],
    })
    await prisma.mailDelivery.update({
      where: { id: delivery.id },
      data: { status: 'sent', sentAt: new Date(), error: null },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Envoi impossible'
    await prisma.mailDelivery.update({
      where: { id: delivery.id },
      data: { status: 'failed', error: message },
    })
    throw error
  }
}
