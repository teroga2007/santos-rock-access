import { config, client, encryptToken, json, mailLog } from '../../server/mail.mjs';

export default async function handler(request) {
  let cfg;
  try { cfg = config(); } catch (error) { mailLog('error', 'configuration_error', { code: error.code, field: error.field }); return json({ configured: false, error: 'Configurá el correo en Netlify antes de usar esta función.' }, 503); }
  if (request.method === 'GET') return json({ configured: true, sending_enabled: cfg.sending, daily_limit: cfg.limit });
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
  if (request.headers.get('origin') && request.headers.get('origin') !== cfg.origin) return json({ error: 'Origen no autorizado.' }, 403);
  const bearer = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!bearer) return json({ error: 'Iniciá sesión nuevamente.' }, 401);
  const db = client(cfg);
  try {
    const { data: auth, error: authError } = await db.auth.getUser(bearer);
    if (authError || !auth.user) return json({ error: 'Sesión no válida.' }, 401);
    const text = await request.text();
    if (text.length > 64000) return json({ error: 'Solicitud demasiado grande.' }, 413);
    let body; try { body = JSON.parse(text); } catch { return json({ error: 'Solicitud no válida.' }, 400); }
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) return json({ error: 'Seleccioná de 1 a 100 entradas.' }, 400);
    const items = [];
    for (const item of body.items) {
      if (typeof item?.ticket_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.ticket_id) || typeof item.token !== 'string' || !/^sra1_[A-Za-z0-9_-]{43}$/.test(item.token)) return json({ error: 'Entrada o credencial no válida.' }, 400);
      const ticketId = item.ticket_id.toLowerCase();
      items.push({ ticket_id: ticketId, token: item.token, encrypted_token: encryptToken(item.token, ticketId, cfg.key) });
    }
    const { data, error } = await db.rpc('queue_ticket_emails', { p_actor_id: auth.user.id, p_items: items });
    if (error) return json({ error: error.code === '42501' ? 'No tenés permiso sobre esas entradas.' : error.code === '22023' ? 'Todas las entradas deben tener un correo de titular válido.' : 'Las entradas deben estar sin usar y sus QR vigentes. Revisá también el estado del evento.' }, 400);
    return json({ jobs: data, sending_enabled: cfg.sending, daily_limit: cfg.limit });
  } catch { return json({ error: 'No se pudo confirmar la cola. Podés reintentar sin duplicar los trabajos.' }, 503); }
}
