import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

function configurationError(field) {
  return Object.assign(new Error('mail_configuration'), { code: 'mail_configuration', field });
}
export function sendingEnabled(env = process.env) {
  const value = String(env.MAIL_SENDING_ENABLED || 'false').trim().toLowerCase();
  if (!['true', 'false'].includes(value)) throw configurationError('MAIL_SENDING_ENABLED');
  return value === 'true';
}
// Deliberately omit exception messages, payloads, addresses and credentials.
export function mailLog(level, event, fields = {}) {
  const safe = {};
  for (const key of ['code', 'field', 'job_id', 'status', 'http_status', 'count']) {
    if (fields[key] !== undefined) safe[key] = fields[key];
  }
  console[level](JSON.stringify({ component: 'ticket_mail', event, ...safe }));
}

export function encryptionKey(value) {
  if (!/^[0-9a-f]{64}$/i.test(value || '')) throw configurationError('MAIL_QUEUE_ENCRYPTION_KEY');
  return Buffer.from(value, 'hex');
}
export function encryptToken(token, ticketId, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(ticketId));
  const body = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}
export function decryptToken(value, ticketId, key) {
  const [version, iv, tag, body] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !body) throw new Error('invalid_envelope');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(ticketId)); decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  const token = Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  if (!/^sra1_[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('invalid_token');
  return token;
}
export function config(env = process.env) {
  const limit = Number(env.EMAIL_DAILY_LIMIT || 80);
  if (!Number.isInteger(limit) || limit < 1 || limit > 250) throw configurationError('EMAIL_DAILY_LIMIT');
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  if (!url) throw configurationError('SUPABASE_URL');
  try { if (!['https:', 'http:'].includes(new URL(url).protocol)) throw new Error(); }
  catch { throw configurationError('SUPABASE_URL'); }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw configurationError('SUPABASE_SERVICE_ROLE_KEY');
  const key = encryptionKey(env.MAIL_QUEUE_ENCRYPTION_KEY);
  const sending = sendingEnabled(env);
  if (sending && !env.BREVO_API_KEY) throw configurationError('BREVO_API_KEY');
  if (sending && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.EMAIL_FROM || '')) throw configurationError('EMAIL_FROM');
  if (env.EMAIL_REPLY_TO && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.EMAIL_REPLY_TO)) throw configurationError('EMAIL_REPLY_TO');
  return { url, key, limit, sending, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY, apiKey: env.BREVO_API_KEY,
    from: env.EMAIL_FROM, fromName: env.EMAIL_FROM_NAME || 'Santos Rock', replyTo: env.EMAIL_REPLY_TO, origin: env.APP_ORIGIN };
}
export const client = cfg => createClient(cfg.url, cfg.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
export const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
export async function emailMessage(job, token, cfg) {
  if (!/^sra1_[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('invalid_token');
  const { default: QRCode } = await import('qrcode');
  const png = await QRCode.toBuffer(token, { width: 600, margin: 4, errorCorrectionLevel: 'M' });
  const startsAt = new Date(job.starts_at);
  const date = new Intl.DateTimeFormat('es-CR', { timeZone: job.timezone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(startsAt);
  const time = new Intl.DateTimeFormat('es-CR', { timeZone: job.timezone, hour: 'numeric', minute: '2-digit', hour12: true }).format(startsAt);
  const firstName = job.holder_name?.trim().split(/\s+/)[0];
  const greeting = firstName ? `¡Hola, ${firstName}! 🤘` : '¡Hola! 🤘';
  const venue = job.venue || 'Lugar por definir';
  const zone = job.access_zone ? job.access_zone[0].toLocaleUpperCase('es') + job.access_zone.slice(1) : 'General';
  const intro = `¡Ya está todo listo para disfrutar de ${job.event_name}! Prepárese para vivir una jornada llena de rock, grandes bandas y mucha energía en las montañas de Los Santos.`;
  const qrNotice = '¡Su código QR está adjunto! Guárdelo y preséntelo al ingresar. Recuerde que es personal, válido para un único ingreso y no debe compartirlo.';
  const manualHelp = 'Si no puede mostrar el QR, presente este código completo al personal de ingreso. Es la misma entrada: usar el QR o el código consume un único ingreso.';
  const textContent = `${greeting}\n\n${intro}\n\n📅 Fecha: ${date}\n🕔 Hora: A partir de las ${time}\n📍 Lugar: ${venue}\n\n🎟️ Su entrada:\nTipo: ${job.type_name}\nZona: ${zone}\n\n📲 ${qrNotice}\n\nCódigo de ingreso manual:\n${token}\n\n${manualHelp}\n\n💬 ¿Tiene alguna consulta?\nPuede contactarnos al WhatsApp: 8689-6331. Con gusto le ayudaremos.\n\n🔥 ¡Gracias por ser parte de ${job.event_name}!\n\n¡Nos vemos frente a la tarima! 🤘`;
  const htmlContent = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:24px 12px;background:#f3f6f4;color:#19352f;font-family:Arial,sans-serif;font-size:16px;line-height:1.6"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden"><tr><td style="padding:24px;background:#061917;color:#fcf106;font-size:22px;font-weight:bold">SANTOS ROCK <span style="color:#ffffff;font-size:14px">ACCESS</span></td></tr><tr><td style="padding:28px"><h1 style="font-size:24px;margin:0 0 16px">${escapeHtml(greeting)}</h1><p>${escapeHtml(intro)}</p><p>📅 <strong>Fecha:</strong> ${escapeHtml(date)}<br>🕔 <strong>Hora:</strong> A partir de las ${escapeHtml(time)}<br>📍 <strong>Lugar:</strong> ${escapeHtml(venue)}</p><h2 style="font-size:19px">🎟️ Su entrada</h2><p><strong>Tipo:</strong> ${escapeHtml(job.type_name)}<br><strong>Zona:</strong> ${escapeHtml(zone)}</p><p>📲 ${escapeHtml(qrNotice)}</p><h2 style="font-size:18px">Código de ingreso manual</h2><p style="padding:14px;background:#edf4ef;border:1px solid #b4cbbd;border-radius:6px;font-family:monospace;font-size:15px;overflow-wrap:anywhere;word-break:break-all">${escapeHtml(token)}</p><p style="font-size:14px">${escapeHtml(manualHelp)}</p><h2 style="font-size:18px">💬 ¿Tiene alguna consulta?</h2><p>Puede contactarnos al WhatsApp: <a href="https://wa.me/50686896331" style="color:#11634f">8689-6331</a>. Con gusto le ayudaremos.</p><p><strong>🔥 ¡Gracias por ser parte de ${escapeHtml(job.event_name)}!</strong></p><p>¡Nos vemos frente a la tarima! 🤘</p></td></tr></table></td></tr></table></body></html>`;
  return {
    sender: { name: cfg.fromName, email: cfg.from }, to: [{ email: job.recipient, name: job.holder_name || 'Asistente' }],
    ...(cfg.replyTo ? { replyTo: { email: cfg.replyTo } } : {}),
    subject: `Su entrada para ${job.event_name} 🤘`.replace(/[\r\n]/g, ' ').slice(0, 200),
    htmlContent, textContent,
    attachment: [{ name: `santos-rock-${job.ticket_id}.png`, content: png.toString('base64') }],
    headers: { idempotencyKey: job.id }, tags: ['santos-rock-access'],
  };
}

export async function emailBundleMessage(entries, cfg, deliveryId) {
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 100) throw new Error('invalid_delivery');
  const first = entries[0].job;
  if (entries.some(({ job }) => job.event_name !== first.event_name || (job.event_id && first.event_id && job.event_id !== first.event_id) || job.recipient.trim().toLowerCase() !== first.recipient.trim().toLowerCase())) throw new Error('delivery_mismatch');
  const messages = [];
  for (const { job, token } of entries) messages.push(await emailMessage(job, token, cfg));
  const message = messages[0];
  message.headers.idempotencyKey = deliveryId;
  if (entries.length === 1) return message;
  const htmlTickets = entries.map(({ job, token }, i) => `<h3 style="font-size:17px">Entrada ${i + 1} de ${entries.length}</h3><p><strong>Titular:</strong> ${escapeHtml(job.holder_name || 'Asistente')}<br><strong>Tipo:</strong> ${escapeHtml(job.type_name)}<br><strong>Zona:</strong> ${escapeHtml(job.access_zone)}</p><p>PNG adjunto: ${escapeHtml(messages[i].attachment[0].name)}</p><p><strong>Código de ingreso manual:</strong></p><p style="font-family:monospace;overflow-wrap:anywhere;word-break:break-all;padding:12px;background:#edf4ef">${escapeHtml(token)}</p>`).join('');
  const textTickets = entries.map(({ job, token }, i) => `Entrada ${i + 1} de ${entries.length}\nTitular: ${job.holder_name || 'Asistente'}\nTipo: ${job.type_name}\nZona: ${job.access_zone}\nPNG adjunto: ${messages[i].attachment[0].name}\nCódigo de ingreso manual:\n${token}`).join('\n\n');
  const notice = 'Cada entrada tiene su propio QR y permite un único ingreso. Comparta con cada acompañante únicamente su entrada. El QR y su código manual representan la misma entrada.';
  message.htmlContent = message.htmlContent.replace(/<h2 style="font-size:19px">🎟️ Su entrada<\/h2>[\s\S]*?(?=<h2 style="font-size:18px">💬)/, () => `<h2>🎟️ Sus ${entries.length} entradas</h2><p>Los ${entries.length} PNG están adjuntos. ${notice}</p>${htmlTickets}`);
  message.textContent = message.textContent.replace(/🎟️ Su entrada:[\s\S]*?(?=💬)/, () => `🎟️ Sus ${entries.length} entradas\nLos ${entries.length} PNG están adjuntos. ${notice}\n\n${textTickets}\n\n`);
  message.subject = `Sus ${entries.length} entradas para ${first.event_name} 🤘`.replace(/[\r\n]/g, ' ').slice(0, 200);
  message.attachment = messages.flatMap(item => item.attachment);
  return message;
}
