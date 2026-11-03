import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase } from './client';
import { SendTicketEmail } from './SendTicketEmail';
const EventEmailQueue = lazy(() => import('./EventEmailQueue').then(module => ({ default: module.EventEmailQueue })));
const TicketActions = lazy(() => import('./TicketActions').then(module => ({ default: module.TicketActions })));
const TicketImport = lazy(() => import('./TicketImport').then(module => ({ default: module.TicketImport })));

type TicketType = { id: string; name: string; capacity: number | null; access_zone: string };
type Ticket = { id: string; type_name: string; full_name: string; source: string; status: string; issued_at: string };
type Issue = { p_event_id: string; p_type_id: string; p_request_id: string; p_token: string; p_full_name: string; p_source: string; p_email: string | null; p_payment_reference: string | null };
type Pending = { args: Issue; qr: string };
const sources: Record<string, string> = { complimentary: 'Cortesía / acreditación', sinpe: 'SINPE', door: 'Puerta', other: 'Otro' };
const statuses: Record<string, string> = { issued: 'Emitida', redeemed: 'Utilizada', void: 'Anulada' };
function errorText(code: string) {
  if (code === 'PGRST202') return 'La emisión no está disponible. Contacte al administrador.';
  if (code === '42501') return 'Su cuenta no tiene permiso para esta operación.';
  if (code === '23514') return 'El evento está cerrado, el tipo no corresponde al evento o su cupo está completo.';
  if (code === '23505') return 'Ese tipo de entrada o credencial ya existe.';
  if (code === '22023') return 'Revise los datos y la referencia del pago.';
  return 'No se pudo confirmar la operación. Revise la conexión y vuelva a intentar.';
}

export function EventTickets({ eventId, organizationId, userId, eventStatus, refreshKey = 0, onPendingChange, onChanged }: { eventId: string; organizationId: string; userId: string; eventStatus: string; refreshKey?: number; onPendingChange?: (value: boolean) => void; onChanged?: () => void }) {
  const [permission, setPermission] = useState<'admin' | 'supervisor' | null>(null);
  const [types, setTypes] = useState<TicketType[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(0);
  const [source, setSource] = useState('complimentary');
  const [pending, setPending] = useState<Pending | null>(null);
  const inFlight = useRef(false);
  const [result, setResult] = useState<{ id: string; qr: string; name: string; token: string; email: string | null } | null>(null);
  const [saved, setSaved] = useState(false);
  const [view, setView] = useState('list');
  const [action, setAction] = useState<{ ticket: Ticket; action: 'void' | 'reissue' } | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [importPending, setImportPending] = useState(false);
  const closed = eventStatus === 'closed' || eventStatus === 'cancelled';
  useEffect(() => {
    onPendingChange?.(busy || !!pending || (!!result && !saved) || actionPending || importPending);
    return () => onPendingChange?.(false);
  }, [busy, pending, result, saved, onPendingChange, actionPending, importPending]);

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let active = true;
    Promise.all([
      client.from('organization_members').select('role').eq('organization_id', organizationId).eq('user_id', userId),
      client.from('event_members').select('role').eq('event_id', eventId).eq('user_id', userId),
    ]).then(([org, event]) => {
      if (!active) return;
      if (org.error || event.error) { setError('No se pudieron cargar los permisos de entradas.'); setLoading(false); return; }
      const admin = org.data?.some(m => m.role === 'owner' || m.role === 'admin') || event.data?.some(m => m.role === 'admin');
      setPermission(admin ? 'admin' : event.data?.some(m => m.role === 'supervisor') ? 'supervisor' : null);
      setLoading(false);
    }).catch(() => { if (active) { setError('No se pudo verificar su acceso a las entradas.'); setLoading(false); } });
    return () => { active = false; };
  }, [eventId, organizationId, userId]);

  useEffect(() => {
    if (!permission || !supabase) return;
    const client = supabase;
    let active = true;
    setLoading(true); setError('');
    Promise.all([
      client.from('ticket_types').select('id,name,capacity,access_zone').eq('event_id', eventId).order('created_at'),
      client.rpc('list_event_tickets', { p_event_id: eventId, p_limit: 20, p_offset: page * 20 }),
    ]).then(([typeResult, ticketResult]) => {
      if (!active) return;
      if (typeResult.error || ticketResult.error) setError(errorText(ticketResult.error?.code || typeResult.error?.code || ''));
      setTypes(typeResult.data || []); setTickets(ticketResult.data || []); setLoading(false);
    }).catch(() => { if (active) { setError('No se pudieron cargar las entradas.'); setLoading(false); } });
    return () => { active = false; };
  }, [permission, eventId, revision, page, refreshKey]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    if (pending || (result && !saved)) window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pending, result, saved]);

  async function createType(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!supabase || inFlight.current) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    inFlight.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const { error } = await supabase.rpc('create_ticket_type', { p_event_id: eventId, p_name: String(data.get('name')).trim(), p_capacity: data.get('capacity') ? Number(data.get('capacity')) : null, p_access_zone: String(data.get('zone')).trim() });
      if (error) { setError(errorText(error.code)); return; }
      form.reset(); setMessage('Tipo de entrada creado.'); setRevision(v => v + 1); onChanged?.();
    } catch { setError('No se pudo confirmar la creación. Actualice los tipos antes de reintentar.'); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function send(request: Pending) {
    if (!supabase || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const { data, error } = await supabase.rpc('issue_ticket', request.args);
      if (error) {
        setError(errorText(error.code));
        if (['42501', '23514', '23505', '22023', 'PGRST202'].includes(error.code)) setPending(null);
        return;
      }
      if (typeof data !== 'string') { setError('Respuesta inesperada. Reintente la misma solicitud para confirmar la emisión.'); return; }
      setResult({ id: data, qr: request.qr, name: request.args.p_full_name, token: request.args.p_token, email: request.args.p_email }); setSaved(false); setPending(null);
      setPage(0); setRevision(v => v + 1); onChanged?.();
    } catch { setError('No se pudo confirmar la emisión. Reintente esta misma solicitud; no se emitirá una segunda entrada.'); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function issue(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (busy || pending || result || inFlight.current || action || importPending) return;
    const data = new FormData(e.currentTarget);
    inFlight.current = true; setBusy(true); setError('');
    try {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const token = 'sra1_' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const { default: QRCode } = await import('qrcode');
      const qr = await QRCode.toDataURL(token, { width: 600, margin: 4, errorCorrectionLevel: 'M' });
      const request: Pending = { qr, args: { p_event_id: eventId, p_type_id: String(data.get('type')), p_request_id: crypto.randomUUID(), p_token: token, p_full_name: String(data.get('holder')).trim(), p_source: source, p_email: String(data.get('email')).trim() || null, p_payment_reference: String(data.get('reference') || '').trim() || null } };
      setPending(request);
      inFlight.current = false;
      await send(request);
    } catch { setError('No se pudo preparar el código QR. Vuelva a intentar o contacte al administrador.'); }
    finally { inFlight.current = false; setBusy(false); }
  }

  if (!permission) return error ? <p className="notice" role="alert">{error}</p> : null;
  return <section className="details-panel ticket-panel" aria-label="Entradas y acreditaciones"><h2>Entradas y acreditaciones</h2>

    {error && <p className="notice" role="alert">{error}</p>}{message && <p role="status" className="created-message">{message}</p>}
    <nav className="ticket-nav" aria-label="Herramientas de entradas">{(permission === 'admin' ? [['list', 'Listado'], ...(!closed ? [['issue', 'Emitir entrada'], ['import', 'Importar CSV'], ['types', 'Tipos de entrada']] : []), ['mail', 'Correos']] : [['list', 'Listado']]).map(([id, label]) => <button className="btn quiet" key={id} aria-current={view === id ? 'page' : undefined} disabled={view !== id && (busy || !!pending || (!!result && !saved) || actionPending || importPending || !!action)} onClick={() => setView(id)}>{label}</button>)}</nav>
    {permission === 'admin' && view === 'mail' && <Suspense fallback={<p role="status">Cargando cola de correo…</p>}><EventEmailQueue eventId={eventId}/></Suspense>}
    {permission === 'admin' && !closed && <>
      <div hidden={view !== 'import'}><Suspense fallback={<p role="status">Cargando importación CSV…</p>}><TicketImport eventId={eventId} types={types} disabled={busy || loading || !!pending || !!action || (!!result && !saved)} onProtectedChange={setImportPending} onChanged={() => { setRevision(v => v + 1); onChanged?.(); }}/></Suspense></div>
      <div hidden={view !== 'types'}><details className="type-setup" open><summary>Nuevo tipo de entrada</summary><p>Por ejemplo: General, Banda, Prensa o Producción. El cupo es por tipo.</p><form onSubmit={createType}><fieldset disabled={busy || !!pending || !!action || importPending}><label>Nombre<input name="name" required minLength={2} maxLength={100}/></label><label>Cupo (vacío = sin límite)<input name="capacity" type="number" min={0} max={2147483647} step={1}/></label><label>Zona de acceso<input name="zone" required maxLength={80} defaultValue="general"/></label><button className="btn primary">Crear tipo</button></fieldset></form></details></div>
      <div hidden={view !== 'issue'}>{result ? <div className="issued-ticket">
        <h3>Entrada emitida</h3><p>{result.name}</p>
        <img src={result.qr} alt="Código QR de la entrada emitida" width={300} height={300}/>
        <p className="ticket-id">{result.id}</p>
        <a className="btn primary download-qr" href={result.qr} download={`santos-rock-${result.id}.png`}>Descargar QR</a>
        <p>Guarde el QR antes de salir.</p>
        {result.email ? <SendTicketEmail items={[{ ticket_id: result.id, token: result.token }]}/> : <p>No se indicó correo del titular. Puede entregar el QR descargado manualmente.</p>}
        <label className="saved-check"><input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)}/> Confirmo que guardé el QR</label>
        <button className="btn quiet" disabled={!saved} onClick={() => setResult(null)}>Emitir otra entrada</button>
      </div>
      : pending ? <div className="notice"><p>La solicitud está pendiente de confirmación. Conserve esta pantalla abierta.</p><button className="btn quiet" disabled={busy} onClick={() => send(pending)}>{busy ? 'Confirmando…' : 'Reintentar la misma emisión'}</button></div>
      : types.length > 0 && <form onSubmit={issue} className="issue-form"><h3>Emitir una entrada</h3><fieldset disabled={busy || loading || !!action || importPending}><label>Tipo<select name="type" required>{types.map(type => <option key={type.id} value={type.id}>{type.name} · {type.access_zone} · {type.capacity === null ? 'sin límite' : `cupo ${type.capacity}`}</option>)}</select></label><label>Nombre del titular<input name="holder" required minLength={2} maxLength={160}/></label><label>Correo (opcional)<input name="email" type="email" maxLength={254}/></label><label>Origen<select value={source} onChange={e => setSource(e.target.value)}>{Object.entries(sources).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>{(source === 'sinpe' || source === 'door') && <><label>Referencia de pago<input name="reference" required maxLength={160}/></label><label className="saved-check"><input type="checkbox" required/> Verifiqué el pago antes de emitir esta entrada</label></>}<button className="btn primary">{busy ? 'Emitiendo…' : 'Emitir entrada y generar QR'}</button></fieldset></form>}
      {!loading && !types.length && <p>Para emitir entradas, agregue primero un tipo en «Tipos de entrada».</p>}</div>
    </>}
    {closed && <p>Este evento está cerrado o cancelado; no admite nuevas emisiones.</p>}
    <div hidden={view !== 'list'}><div className="form-heading"><h3>Entradas emitidas</h3><button className="btn quiet" disabled={busy || loading} onClick={() => setRevision(v => v + 1)}>Actualizar</button></div>{loading ? <p role="status">Cargando entradas…</p> : tickets.length ? <div className="ticket-table"><table><thead><tr><th>Titular</th><th>Tipo</th><th>Origen</th><th>Estado</th><th>Emitida</th>{permission === 'admin' && <th>Acciones</th>}</tr></thead><tbody>{tickets.map(ticket => <tr key={ticket.id}><td title={ticket.id}>{ticket.full_name}</td><td>{ticket.type_name}</td><td>{sources[ticket.source] || ticket.source}</td><td><span className={'status-badge status-' + ticket.status}>{statuses[ticket.status] || ticket.status}</span></td><td>{new Intl.DateTimeFormat('es-CR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Costa_Rica' }).format(new Date(ticket.issued_at))}</td>{permission === 'admin' && <td>{ticket.status === 'issued' && ticket.source !== 'ticketera' ? <div className="ticket-row-actions"><button className="btn quiet" disabled={busy || importPending || !!pending || (!!result && !saved) || !!action || closed} onClick={() => { setResult(null); setAction({ ticket, action: 'reissue' }); }}>Reemitir QR</button><button className="btn quiet" disabled={busy || importPending || !!pending || (!!result && !saved) || !!action} onClick={() => { setResult(null); setAction({ ticket, action: 'void' }); }}>Anular</button></div> : '—'}</td>}</tr>)}</tbody></table></div> : <p>No hay entradas para mostrar.</p>}
    {action && <Suspense fallback={<p role="status">Cargando acciones de la entrada…</p>}><TicketActions key={action.ticket.id + action.action} ticket={action.ticket} action={action.action} onClose={() => setAction(null)} onChanged={() => { setRevision(v => v + 1); onChanged?.(); }} onPendingChange={setActionPending}/></Suspense>}
    <div className="ticket-pagination"><button className="btn quiet" disabled={busy || loading || page === 0} onClick={() => setPage(v => v - 1)}>Anterior</button><span>Página {page + 1}</span><button className="btn quiet" disabled={busy || loading || tickets.length < 20} onClick={() => setPage(v => v + 1)}>Siguiente</button></div></div>
  </section>;
}
