import { Injectable } from '@nestjs/common';
import { EmailInterface } from '@gitroom/nestjs-libraries/emails/email.interface';
import { ResendProvider } from '@gitroom/nestjs-libraries/emails/resend.provider';
import { EmptyProvider } from '@gitroom/nestjs-libraries/emails/empty.provider';
import { NodeMailerProvider } from '@gitroom/nestjs-libraries/emails/node.mailer.provider';
import { JobQueueService } from '@gitroom/nestjs-libraries/jobs/job.queue';
import { emailQueues } from '@gitroom/nestjs-libraries/jobs/job.queues';
import { timer } from '@gitroom/helpers/utils/timer';

@Injectable()
export class EmailService {
  emailService: EmailInterface;
  constructor(private _jobQueue: JobQueueService) {
    this.emailService = this.selectProvider(process.env.EMAIL_PROVIDER!);
    console.log('Email service provider:', this.emailService.name);
    for (const key of this.emailService.validateEnvKeys) {
      if (!process.env[key]) {
        console.error(`Missing environment variable: ${key}`);
      }
    }
  }

  hasProvider() {
    return !(this.emailService instanceof EmptyProvider);
  }

  selectProvider(provider: string) {
    switch (provider) {
      case 'resend':
        return new ResendProvider();
      case 'nodemailer':
        return new NodeMailerProvider();
      default:
        return new EmptyProvider();
    }
  }

  async sendEmail(
    to: string,
    subject: string,
    html: string,
    addTo: 'top' | 'bottom',
    replyTo?: string
  ) {
    if (!to || !subject) {
      return;
    }

    // One job per email; the Resend rate limit is the email queue's. A send
    // is repeated a few times, with growing waits.
    return this._jobQueue.enqueue(
      'email.send',
      { to, subject, html, replyTo },
      {
        queue:
          addTo === 'top'
            ? emailQueues.priority.taskQueue
            : emailQueues.bulk.taskQueue,
        maxAttempts: 5,
        retryDelayMs: 10_000,
        backoff: 2,
      }
    );
  }

  async sendEmailSync(
    to: string,
    subject: string,
    html: string,
    replyTo?: string
  ) {
    if (to.indexOf('@') === -1) {
      return;
    }

    if (!process.env.EMAIL_FROM_ADDRESS || !process.env.EMAIL_FROM_NAME) {
      console.log(
        'Email sender information not found in environment variables'
      );
      return;
    }

    const modifiedHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f5;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;border-radius:12px;background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            <tr>
              <td align="left" style="background-color:#0e0e0e;border-radius:12px 12px 0 0;padding:24px 28px;">
                <img src="${process.env.FRONTEND_URL}/email-logo.png" width="160" height="32" alt="Omninoise" style="display:block;border:0;">
              </td>
            </tr>
            <tr>
              <td style="padding:28px 28px 8px 28px;">
                <h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.3;font-weight:700;color:#111827;">${subject}</h1>
                <div style="font-size:15px;line-height:1.6;color:#374151;">
                  ${html}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px 28px 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #e5e7eb;">
                  <tr>
                    <td style="padding-top:20px;">
                      <div style="font-size:13px;font-weight:600;color:#111827;">${process.env.EMAIL_FROM_NAME}</div>
                      <div style="padding-top:4px;font-size:13px;line-height:1.5;color:#6b7280;">
                        You can change your notification preferences in your <a href="${process.env.FRONTEND_URL}/settings" style="color:#D04430;">account settings.</a>
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
          <div style="padding-top:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:#9ca3af;">
            &copy; ${new Date().getFullYear()} ${process.env.EMAIL_FROM_NAME}
          </div>
        </td>
      </tr>
    </table>
    `;

    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const sends = await this.emailService.sendEmail(
          to,
          subject,
          modifiedHtml,
          process.env.EMAIL_FROM_NAME,
          process.env.EMAIL_FROM_ADDRESS,
          replyTo
        );
        console.log(sends);
        return;
      } catch (err) {
        lastErr = err;
        console.log(`Email attempt ${attempt + 1}/3 failed:`, err);
        if (attempt < 2) {
          await timer(700);
        }
      }
    }
    console.log(`Email to ${to} failed after 3 attempts:`, lastErr);
  }
}
