import { createTransport, Transporter } from 'nodemailer';
import { config } from './config';

interface MailPayload {
  to: string;
  subject: string;
  text: string;
  html: string;
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = createTransport({
      host: config.email.smtp.host,
      port: config.email.smtp.port,
      secure: config.email.smtp.port === 465,
      auth: config.email.smtp.user
        ? { user: config.email.smtp.user, pass: config.email.smtp.pass }
        : undefined,
    });
  }
  return transporter;
}

export async function sendMail(payload: MailPayload): Promise<void> {
  if (config.email.mode !== 'smtp') {
    console.log('----------------------------------------');
    console.log(`[email:log] To: ${payload.to}`);
    console.log(`[email:log] Subject: ${payload.subject}`);
    console.log(`[email:log] ${payload.text}`);
    console.log('----------------------------------------');
    return;
  }
  await getTransporter().sendMail({ from: config.email.from, ...payload });
}

export async function sendVerificationEmail(
  to: string,
  username: string,
  token: string
): Promise<void> {
  const link = `${config.clientUrl}/verify-email?token=${encodeURIComponent(token)}`;
  await sendMail({
    to,
    subject: 'Verify your CashDash email',
    text: `Hi ${username}, confirm your email to unlock cashouts: ${link}\nThis link expires in 24 hours.`,
    html: `<p>Hi ${username},</p><p>Confirm your email to unlock cashouts:</p><p><a href="${link}">Verify my email</a></p><p>This link expires in 24 hours.</p>`,
  });
}

export async function sendPasswordResetEmail(
  to: string,
  username: string,
  token: string
): Promise<void> {
  const link = `${config.clientUrl}/reset-password?token=${encodeURIComponent(token)}`;
  await sendMail({
    to,
    subject: 'Reset your CashDash password',
    text: `Hi ${username}, set a new password: ${link}\nThis link expires in 1 hour. If you did not request this, ignore this email.`,
    html: `<p>Hi ${username},</p><p>Set a new password:</p><p><a href="${link}">Reset my password</a></p><p>This link expires in 1 hour. If you did not request this, ignore this email.</p>`,
  });
}

export async function sendWithdrawalStatusEmail(
  to: string,
  username: string,
  status: 'approved' | 'rejected',
  amountCents: number,
  method: string
): Promise<void> {
  const amount = `$${(amountCents / 100).toFixed(2)}`;
  const methodLabel = method.replace('_', ' ');
  if (status === 'approved') {
    await sendMail({
      to,
      subject: 'Your CashDash withdrawal was approved',
      text: `Hi ${username}, your ${amount} withdrawal via ${methodLabel} has been approved and is on its way. Thanks for being part of CashDash!`,
      html: `<p>Hi ${username},</p><p>Your <strong>${amount}</strong> withdrawal via ${methodLabel} has been approved and is on its way.</p><p>Thanks for being part of CashDash!</p>`,
    });
    return;
  }
  await sendMail({
    to,
    subject: 'Your CashDash withdrawal needs attention',
    text: `Hi ${username}, your ${amount} withdrawal via ${methodLabel} was declined. The full amount has been refunded to your CashDash balance — you can request a new payout anytime from your dashboard.`,
    html: `<p>Hi ${username},</p><p>Your <strong>${amount}</strong> withdrawal via ${methodLabel} was declined. The full amount has been refunded to your CashDash balance — you can request a new payout anytime from your dashboard.</p>`,
  });
}
