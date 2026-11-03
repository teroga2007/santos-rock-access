import { useEffect, useState } from 'react';
import { supabase } from './client';
export function SendTicketEmail({ items }: { items: { ticket_id: string; token: string }[] }) {
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [enabled, setEnabled] = useState(false);
  const [limit, setLimit] = useState(80);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [queued, setQueued] = useState(false);
  useEffect(() => {
    let active = true; setChecking(true);
    fetch('/.netlify/functions/queue-ticket-emails', { cache: 'no-store' }).then(response => response.json()).then(data => {
      if (active) { setReady(data.configured === true); setEnabled(data.sending_enabled === true); if (data.daily_limit) setLimit(data.daily_limit); }
    }).catch(() => { if (active) setReady(false); }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [revision]);
  async function queue() {
    if (!supabase || busy || queued) return;
    setBusy(true); setMessage(''); setFailed(false);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) { setMessage('Inicie sesión nuevamente.'); setFailed(true); return; }
      const response = await fetch('/.netlify/functions/queue-ticket-emails', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify({ items }) });
      const result = await response.json();
      if (!response.ok) { setMessage('No se pudo programar el correo. Revise el correo del titular y vuelva a intentar.'); setFailed(true); return; }
      setQueued(true); setEnabled(result.sending_enabled === true);
      setMessage(result.jobs.length === 1 ? 'Correo en cola.' : result.jobs.length + ' correos en cola.');
    } catch { setMessage('No se pudo confirmar el envío a la cola. Conserve el QR y vuelva a intentar.'); setFailed(true); }
    finally { setBusy(false); }
  }
  if (!items.length) return null;
  return <div className="email-send"><h4>Entrega por correo</h4>{checking ? <p role="status">Consultando disponibilidad…</p> : ready ? <><p>{enabled ? 'Hasta ' + limit + ' envíos diarios.' : 'Envíos pausados. Los correos quedarán pendientes.'}</p><button className="btn quiet" disabled={busy || queued} onClick={queue}>{busy ? 'Agregando…' : queued ? 'En cola' : items.length === 1 ? 'Agregar correo a la cola' : 'Agregar ' + items.length + ' correos a la cola'}</button></> : <><p>Correo no disponible. Guarde el QR para entregarlo manualmente.</p><button className="btn quiet" onClick={() => setRevision(v => v + 1)}>Reintentar consulta</button></>}{message && <p className={failed ? 'notice' : 'created-message'} role={failed ? 'alert' : 'status'}>{message}</p>}</div>;
}
