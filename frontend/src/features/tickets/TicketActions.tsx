import { useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { SendTicketEmail } from '../mail/SendTicketEmail';
import { EmailDeliveryChoice } from '../mail/EmailDeliveryChoice';

type Request = { p_ticket_id: string; p_action: 'void' | 'reissue'; p_request_id: string; p_reason: string; p_new_token: string | null };
type Pending = { args: Request; qr: string | null; sendEmail: boolean };
export function TicketActions({ ticket, action, onClose, onChanged, onPendingChange }: {
  ticket: { id: string; full_name: string; type_name: string }; action: 'void' | 'reissue';
  onClose: () => void; onChanged: () => void; onPendingChange: (value: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [success, setSuccess] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [recipient, setRecipient] = useState<string | null | undefined>(undefined);
  const [recipientError, setRecipientError] = useState(false);
  const [sendEmail, setSendEmail] = useState(false);
  const [automaticEmail, setAutomaticEmail] = useState(false);
  const [emailPending, setEmailPending] = useState(false);
  useEffect(() => {
    if (action !== 'reissue' || !supabase) return;
    let active = true;
    Promise.resolve(supabase.rpc('get_ticket_email_recipient', { p_ticket_id: ticket.id })).then(({ data, error }) => {
      if (active) { setRecipient(error ? null : data || null); setRecipientError(!!error); }
    }).catch(() => { if (active) { setRecipient(null); setRecipientError(true); } });
    return () => { active = false; };
  }, [action, ticket.id]);
  const lock = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const protectedState = busy || !!pending || (success && action === 'reissue' && !saved) || emailPending;
  useEffect(() => { heading.current?.focus(); heading.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, []);
  useEffect(() => { onPendingChange(protectedState); return () => onPendingChange(false); }, [protectedState, onPendingChange]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    if (protectedState) window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [protectedState]);

  async function send(request: Pending) {
    if (!supabase || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const { data, error } = await supabase.rpc('manage_ticket_credential', request.args);
      if (error) {
        setError(error.code === '42501' ? 'No tiene permiso para administrar esta entrada.' : error.code === '23514' ? 'La entrada ya fue usada o anulada, no es nativa, o el evento está cerrado para reemitir.' : error.code === 'PGRST202' ? 'Falta habilitar las acciones de entrada en la base de datos.' : error.code === '22023' ? 'Revise el motivo y los datos de la solicitud.' : error.code === '23505' ? 'La credencial nueva ya existe; no se aplicó el cambio.' : 'No se pudo confirmar el cambio. Conserve esta pantalla y reintente la misma solicitud.');
        if (['42501','23514','PGRST202','22023','23505'].includes(error.code)) setPending(null);
        return;
      }
      if (data !== ticket.id) { setError('Respuesta inesperada. Reintente la misma solicitud para confirmar el cambio.'); return; }
      setQr(request.qr); setToken(request.args.p_new_token); setAutomaticEmail(request.sendEmail); setSuccess(true); setPending(null); onChanged();
    } catch { setError('No se pudo confirmar el cambio. Reintente la misma solicitud antes de entregar un QR.'); }
    finally { lock.current = false; setBusy(false); }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (lock.current || pending || success) return;
    const data = new FormData(e.currentTarget);
    lock.current = true; setBusy(true); setError('');
    try {
      let token: string | null = null; let image: string | null = null;
      if (action === 'reissue') {
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        token = 'sra1_' + btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
        const { default: QRCode } = await import('qrcode');
        image = await QRCode.toDataURL(token, { width: 600, margin: 4, errorCorrectionLevel: 'M' });
      }
      const request: Pending = { qr: image, sendEmail: action === 'reissue' && sendEmail && !!recipient, args: { p_ticket_id: ticket.id, p_action: action, p_request_id: crypto.randomUUID(), p_reason: String(data.get('reason')).trim(), p_new_token: token } };
      setPending(request); lock.current = false; await send(request);
    } catch { setError('No se pudo preparar la operación. Vuelva a intentar o contacte al administrador.'); }
    finally { lock.current = false; setBusy(false); }
  }

  return <section className="ticket-action-panel" aria-label="Acción sobre la entrada"><h3 tabIndex={-1} ref={heading}>{action === 'void' ? 'Anular entrada' : 'Reemitir QR'}</h3><p>{ticket.full_name} · {ticket.type_name}</p><p className="ticket-id">{ticket.id}</p>
    {error && <div className="notice" role="alert">{error}</div>}
    {success ? <div role="status">
      <p className="created-message">{action === 'void' ? 'Entrada anulada. Sus códigos ya no permiten ingresar.' : 'QR reemitido. Los códigos anteriores quedaron invalidados.'}</p>
      {qr && <>
        <img src={qr} width={300} height={300} alt="Nuevo QR de la misma entrada"/>
        <a className="btn primary download-qr" download={`santos-rock-${ticket.id}-nuevo.png`} href={qr}>Descargar nuevo QR</a>
        <p>Guarde este QR. El envío por correo usa la dirección registrada del titular.</p>
        {token && recipient && <SendTicketEmail items={[{ ticket_id: ticket.id, token, recipient }]} autoQueue={automaticEmail} onPendingChange={setEmailPending}/>}
        {recipientError && <p>No se pudo consultar el correo del titular. Conserve el QR para la entrega manual.</p>}
        {!recipient && !recipientError && <p>No hay correo registrado del titular.</p>}
        <label className="saved-check"><input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)}/> Confirmo que guardé el nuevo QR</label>
      </>}
      <button className="btn quiet" disabled={protectedState} onClick={onClose}>Terminar</button>
    </div>
    : pending ? <div className="notice"><p>La operación está pendiente de confirmación. No cierres la pantalla.</p><button className="btn quiet" disabled={busy} onClick={() => send(pending)}>{busy ? 'Confirmando…' : 'Reintentar la misma solicitud'}</button></div>
    : <form onSubmit={submit}><fieldset disabled={busy}><p>{action === 'void' ? 'La entrada dejará de ser válida y liberará su cupo. Esta acción no devuelve pagos ni permite restaurarla desde la aplicación.' : 'Se conserva la misma entrada, titular y cupo. Todos sus QR anteriores dejarán de funcionar.'}</p><label>Motivo<input name="reason" required minLength={5} maxLength={300} placeholder="Ej.: QR perdido por el titular"/></label>{action === 'reissue' && (recipient ? <EmailDeliveryChoice label="Enviar el nuevo QR por correo" recipients={[recipient]} checked={sendEmail} onChange={setSendEmail}/> : <p>{recipient === undefined ? 'Consultando correo del titular…' : recipientError ? 'No se pudo consultar el correo. Puede reemitir y guardar el QR.' : 'Sin correo registrado. Entregue el QR manualmente.'}</p>)}<label className="saved-check"><input type="checkbox" required/> Confirmo la operación sobre esta entrada sin usar</label><button className="btn primary">{busy ? 'Guardando…' : action === 'void' ? 'Confirmar anulación' : 'Invalidar QR anterior y generar nuevo'}</button><button type="button" className="btn quiet" disabled={busy} onClick={onClose}>Cancelar</button></fieldset></form>}
  </section>;
}
