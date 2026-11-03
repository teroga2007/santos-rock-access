import { useEffect, useState } from 'react';
import { supabase } from './client';
export function SendTicketEmail({ items }: { items: { ticket_id: string; token: string }[] }) {
  const [ready, setReady] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [limit, setLimit] = useState(80);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [queued, setQueued] = useState(false);
  useEffect(() => {
    let active = true;
    fetch('/.netlify/functions/queue-ticket-emails', { cache: 'no-store' }).then(response => response.json()).then(data => {
      if (active) { setReady(data.configured === true); setEnabled(data.sending_enabled === true); if (data.daily_limit) setLimit(data.daily_limit); }
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  async function queue() {
    if (!supabase || busy || queued) return;
    setBusy(true); setMessage('');
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) { setMessage('Iniciá sesión nuevamente.'); return; }
      const response = await fetch('/.netlify/functions/queue-ticket-emails', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify({ items }) });
      const result = await response.json();
      if (!response.ok) { setMessage(result.error || 'No se pudo confirmar la cola. Podés reintentar.'); return; }
      setQueued(true); setEnabled(result.sending_enabled === true);
      setMessage(`${result.jobs.length} trabajo(s) registrados. Se respetará el límite diario y no se duplicarán por reintentar.`);
    } catch { setMessage('No se pudo confirmar la cola. Conservá el QR y reintentá; el registro es idempotente.'); }
    finally { setBusy(false); }
  }
  if (!items.length) return null;
  return <div className="email-send"><h4>Entrega por correo</h4>{ready ? <><p>Límite de la aplicación: {limit} envíos diarios. {enabled ? 'La cola se procesa automáticamente.' : 'El envío está pausado; los trabajos quedarán pendientes hasta activarlo.'}</p><button className="quiet" disabled={busy || queued} onClick={queue}>{busy ? 'Registrando…' : queued ? 'Trabajos registrados' : `Poner ${items.length} entrada(s) en cola de correo`}</button></> : <p>El correo estará disponible al configurar Brevo y las variables privadas en Netlify. Guardá el QR o ZIP mientras tanto.</p>}{message && <p role="status">{message}</p>}</div>;
}
