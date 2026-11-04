import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { mailTiming, useMailAvailability, validMail } from './mailAvailability';

export type EmailItem = { ticket_id: string; token: string; recipient?: string | null };
type Props = { items: EmailItem[]; autoQueue?: boolean; onPendingChange?: (pending: boolean) => void };
const labels: Record<string, string> = { pending: 'Pendiente', processing: 'Procesando', submitted: 'Aceptado por Brevo', failed: 'Rechazado / error', unknown: 'Requiere revisión', cancelled: 'Cancelado' };
export function SendTicketEmail(props: Props) {
  if (!props.items.length) return null;
  return <EmailDelivery key={props.items.map(item => item.ticket_id + ':' + item.token).join('|')} {...props}/>;
}
function EmailDelivery({ items, autoQueue = false, onPendingChange }: Props) {
  const availability = useMailAvailability();
  const invalidRecipient = items.some(item => item.recipient != null && !validMail(item.recipient));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [jobs, setJobs] = useState<{ id: string; status: string }[] | null>(null);
  const [sending, setSending] = useState<boolean | null>(null);
  const inFlight = useRef(false); const registered = useRef(false); const attempted = useRef(false);
  const currentItems = useRef(items); currentItems.current = items;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const queue = useCallback(async () => {
    if (!supabase || inFlight.current || registered.current) return;
    inFlight.current = true; setBusy(true); setMessage(''); setFailed(false);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error('session');
      const response = await fetch('/.netlify/functions/queue-ticket-emails', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token },
        body: JSON.stringify({ items: currentItems.current.map(({ ticket_id, token }) => ({ ticket_id, token })) }),
      });
      const result = await response.json();
      if (!mounted.current) return;
      if (!response.ok) { setFailed(true); setMessage(response.status === 401 ? 'Inicie sesión nuevamente para programar el correo.' : response.status >= 500 ? 'No se pudo confirmar el correo. Reintente solo el correo, sin emitir otra entrada.' : 'No se pudo programar el correo. Revise que la entrada esté vigente y tenga un correo válido.'); return; }
      if (!Array.isArray(result.jobs) || result.jobs.length !== currentItems.current.length || result.jobs.some((job: { status?: string }) => !job || typeof job.status !== 'string' || !(job.status in labels))) throw new Error('response');
      registered.current = true; setJobs(result.jobs); setSending(result.sending_enabled === true);
    } catch {
      if (mounted.current) { setFailed(true); setMessage('La entrada ya está emitida, pero no se pudo confirmar el correo. Reintente el correo sin emitir otra entrada.'); }
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }, []);
  useEffect(() => {
    if (autoQueue && !invalidRecipient && availability.ready && !availability.checking && !attempted.current) { attempted.current = true; void queue(); }
  }, [autoQueue, invalidRecipient, availability.ready, availability.checking, queue]);
  const waiting = busy || (autoQueue && availability.checking && !attempted.current);
  useEffect(() => { onPendingChange?.(waiting); return () => onPendingChange?.(false); }, [waiting, onPendingChange]);
  const enabled = sending ?? availability.enabled;
  const states = [...new Set(jobs?.map(job => job.status) || [])];
  return <div className="email-send"><h4>Entrega por correo</h4>
    {items.length === 1 ? <p className="email-recipient">Para: <strong>{items[0].recipient || 'correo registrado del titular'}</strong></p> : <details><summary>{items.length} entradas con correo · Ver destinatarios</summary><ul>{items.map((item, i) => <li key={item.ticket_id}>{item.recipient || 'Correo registrado · entrada ' + (i + 1)}</li>)}</ul></details>}
    {invalidRecipient ? <p className="notice">El correo registrado no es válido. Conserve el QR para entregarlo manualmente.</p> : availability.checking && !jobs ? <p role="status">Consultando disponibilidad…</p> : jobs ? <div role="status">
      <p className="created-message">{jobs.length === 1 ? labels[jobs[0].status] : jobs.length + ' correos registrados.'}</p>
      {states.some(status => status === 'pending' || status === 'processing') && <p>{enabled ? mailTiming : 'Envíos pausados. El correo queda pendiente hasta que se activen.'}</p>}
      {states.includes('submitted') && <p>Brevo aceptó el correo. La entrega en la bandeja aún no está confirmada.</p>}
      {states.some(status => ['failed','unknown','cancelled'].includes(status)) && <p className="notice">Revise el detalle en Entradas → Correos antes de volver a enviar.</p>}
      <small>Puede consultar cada estado en Entradas → Correos.</small>
    </div> : availability.ready ? <><p>{enabled ? mailTiming : 'Envíos pausados. Puede dejar el correo pendiente para enviarlo al activar el servicio.'}</p><button className="btn quiet" disabled={busy} onClick={queue}>{busy ? 'Programando correo…' : failed ? 'Reintentar correo' : items.length === 1 ? 'Programar correo' : 'Programar ' + items.length + ' correos'}</button></> : <><p>{autoQueue ? 'No se pudo programar el correo. Guarde el QR y reintente la consulta.' : 'Correo no disponible. Guarde el QR para entregarlo manualmente.'}</p><button className="btn quiet" onClick={availability.reload}>Reintentar consulta</button></>}
    {message && <p className={failed ? 'notice' : 'created-message'} role={failed ? 'alert' : 'status'}>{message}</p>}
    <details className="mail-limits"><summary>Cómo funciona el envío</summary><p>Hasta {availability.limit} intentos diarios, procesados por tandas. Programar no confirma entrega. Conserve una copia del QR.</p></details>
  </div>;
}
