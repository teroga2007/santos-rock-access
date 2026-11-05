import { preparePurchaseQr, type PurchaseQr } from './purchaseQr';
import { EmailDeliveryChoice } from '../mail/EmailDeliveryChoice';
import { SortHeader, type SortState } from '../../components/tableSort';
import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { SendTicketEmail } from '../mail/SendTicketEmail';
import { TicketTypePrices } from './TicketTypePrices';
import { crc, pricing, type PricedTicketType } from './ticketPricing';
const EventEmailQueue = lazy(() => import('../mail/EventEmailQueue').then(module => ({ default: module.EventEmailQueue })));
const TicketActions = lazy(() => import('./TicketActions').then(module => ({ default: module.TicketActions })));
const TicketImport = lazy(() => import('./TicketImport').then(module => ({ default: module.TicketImport })));

type TicketType = PricedTicketType;
type Ticket = { id: string; type_name: string; full_name: string; source: string; status: string; issued_at: string };
type Issue = { p_event_id: string; p_type_id: string; p_request_id: string; p_token: string; p_full_name: string; p_source: string; p_email: string | null; p_payment_reference: string | null; p_expected_price_crc: number | null; p_expected_transport_crc: number; p_payment_confirmed: boolean };
type Pending = { args: Issue; qr: string; entries: PurchaseQr[]; url: string | null; sendEmail: boolean };
const sources: Record<string, string> = { complimentary: 'Cortesía / acreditación', sinpe: 'SINPE', door: 'Puerta', other: 'Otro', ticketera: 'La Tiquetera' };
const statuses: Record<string, string> = { issued: 'Emitida', redeemed: 'Utilizada', void: 'Anulada' };
function errorText(code: string) {
  if (code === 'PGRST202') return 'La emisión no está disponible. Contacte al administrador.';
  if (code === '42501') return 'Su cuenta no tiene permiso para esta operación.';
  if (code === '23514') return 'El evento está cerrado, el tipo no corresponde al evento o su cupo está completo.';
  if (code === '23505') return 'Ese tipo de entrada o credencial ya existe.';
  if (code === 'P0001') return 'La tarifa cambió. Actualice las entradas y revise el pago antes de volver a emitir.';
  if (code === '22023') return 'Revise los datos, la cantidad y la confirmación del pago.';
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
  const [tableSort, setTableSort] = useState<SortState>({ key: 'issued_at', direction: 'desc' });
  function sortTickets(key: string) { setTableSort(current => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' })); setPage(0); }
  const [quantity, setQuantity] = useState(1);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const qrUrl = useRef<string | null>(null);
  useEffect(() => () => { if (qrUrl.current) URL.revokeObjectURL(qrUrl.current); }, []);
  const [source, setSource] = useState('complimentary');
  const [emailDraft, setEmailDraft] = useState('');
  const [sendEmail, setSendEmail] = useState(false);
  const [emailPending, setEmailPending] = useState(false);
  const [selectedType, setSelectedType] = useState('');
  const [pricesPending, setPricesPending] = useState(false);
  const selectedPrice = pricing(types.find(t => t.id === (selectedType || types[0]?.id)));
  const effectiveSource = (selectedPrice.paid && source === 'complimentary') || (selectedPrice.transport > 0 && source === 'door') ? 'sinpe' : source;
  useEffect(() => { setPaymentConfirmed(false); }, [quantity, selectedType, effectiveSource, selectedPrice.admission, selectedPrice.transport]);
  const [pending, setPending] = useState<Pending | null>(null);
  const inFlight = useRef(false);
  const [result, setResult] = useState<{ id: string; qr: string; name: string; token: string; email: string | null; sendEmail: boolean; entries: (PurchaseQr & { id: string })[]; url: string | null } | null>(null);
  const [saved, setSaved] = useState(false);
  const [view, setView] = useState('list');
  const [action, setAction] = useState<{ ticket: Ticket; action: 'void' | 'reissue' } | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [importPending, setImportPending] = useState(false);
  const closed = eventStatus === 'closed' || eventStatus === 'cancelled';
  useEffect(() => {
    onPendingChange?.(busy || !!pending || (!!result && !saved) || actionPending || importPending || pricesPending || emailPending);
    return () => onPendingChange?.(false);
  }, [busy, pending, result, saved, onPendingChange, actionPending, importPending, pricesPending, emailPending]);

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
      client.from('ticket_types').select('id,name,capacity,access_zone,price_crc,transport_price_crc,category').eq('event_id', eventId).order('created_at'),
      client.rpc('list_event_tickets_sorted', { p_event_id: eventId, p_limit: 20, p_offset: page * 20, p_sort_by: tableSort.key, p_ascending: tableSort.direction === 'asc' }),
    ]).then(([typeResult, ticketResult]) => {
      if (!active) return;
      if (typeResult.error || ticketResult.error) setError(errorText(ticketResult.error?.code || typeResult.error?.code || ''));
      setTypes(typeResult.data || []); setSelectedType(current => typeResult.data?.some(type => type.id === current) ? current : ''); setTickets(ticketResult.data || []); setLoading(false);
    }).catch(() => { if (active) { setError('No se pudieron cargar las entradas.'); setLoading(false); } });
    return () => { active = false; };
  }, [permission, eventId, revision, page, refreshKey, tableSort]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    if (pending || (result && !saved)) window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pending, result, saved]);

  async function send(request: Pending) {
    if (!supabase || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const { data, error } = await supabase.rpc('issue_ticket_purchases', { p_event_id: eventId, p_type_id: request.args.p_type_id, p_request_id: request.args.p_request_id, p_rows: [{ name: request.args.p_full_name, email: request.args.p_email, quantity: request.entries.length, tokens: request.entries.map(entry => entry.token) }], p_source: request.args.p_source, p_expected_price_crc: request.args.p_expected_price_crc, p_expected_transport_crc: request.args.p_expected_transport_crc, p_payment_confirmed: request.args.p_payment_confirmed, p_import: false });
      if (error) {
        setError(errorText(error.code));
        if (['42501', '23514', '23505', '22023', 'P0001', 'PGRST202'].includes(error.code)) { setPending(null); if (request.url) URL.revokeObjectURL(request.url); qrUrl.current = null; }
        if (error.code === 'P0001') { setPaymentConfirmed(false); setRevision(value => value + 1); }
        return;
      }
      if (!Array.isArray(data?.tickets) || data.tickets.length !== request.entries.length || data.tickets.some((ticket: { ticket_id?: string }) => typeof ticket.ticket_id !== 'string')) { setError('Respuesta inesperada. Reintente la misma solicitud para confirmar la emisión.'); return; }
      setResult({ entries: request.entries.map((entry, i) => ({ ...entry, id: data.tickets[i].ticket_id })), url: request.url, id: data.tickets[0].ticket_id, qr: request.qr, name: request.args.p_full_name, token: request.args.p_token, email: request.args.p_email, sendEmail: request.sendEmail }); setSaved(false); setPending(null);
      setPage(0); setRevision(v => v + 1); onChanged?.();
    } catch { setError('No se pudo confirmar la emisión. Reintente esta misma solicitud; no se emitirá una segunda entrada.'); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function issue(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (busy || pending || result || inFlight.current || action || importPending) return;
    const data = new FormData(e.currentTarget);
    inFlight.current = true; setBusy(true); setError('');
    try {
      const prepared = await preparePurchaseQr(quantity);
      qrUrl.current = prepared.url;
      const { token, qr } = prepared.entries[0];
      const request: Pending = { qr, entries: prepared.entries, url: prepared.url, sendEmail: sendEmail && !!emailDraft.trim(), args: { p_event_id: eventId, p_type_id: String(data.get('type')), p_request_id: crypto.randomUUID(), p_token: token, p_full_name: String(data.get('holder')).trim(), p_source: effectiveSource, p_expected_price_crc: selectedPrice.known ? selectedPrice.admission : null, p_expected_transport_crc: selectedPrice.transport, p_payment_confirmed: paymentConfirmed, p_email: String(data.get('email')).trim() || null, p_payment_reference: String(data.get('reference') || '').trim() || null } };
      setPending(request);
      inFlight.current = false;
      await send(request);
    } catch { setError('No se pudo preparar el código QR. Vuelva a intentar o contacte al administrador.'); }
    finally { inFlight.current = false; setBusy(false); }
  }

  if (!permission) return error ? <p className="notice" role="alert">{error}</p> : null;
  return <section className="details-panel ticket-panel" aria-label="Entradas y acreditaciones"><h2>Entradas y acreditaciones</h2>

    {error && <p className="notice" role="alert">{error}</p>}{message && <p role="status" className="created-message">{message}</p>}
    <nav className="ticket-nav" aria-label="Herramientas de entradas">{(permission === 'admin' ? [['list', 'Listado'], ...(!closed ? [['issue', 'Emitir entrada'], ['import', 'Importar CSV'], ['types', 'Tipos de entrada']] : []), ['mail', 'Correos']] : [['list', 'Listado']]).map(([id, label]) => <button className="btn quiet" key={id} aria-current={view === id ? 'page' : undefined} disabled={view !== id && (busy || !!pending || (!!result && !saved) || actionPending || importPending || pricesPending || emailPending || !!action)} onClick={() => setView(id)}>{label}</button>)}</nav>
    {permission === 'admin' && view === 'mail' && <Suspense fallback={<p role="status">Cargando cola de correo…</p>}><EventEmailQueue eventId={eventId}/></Suspense>}
    {permission === 'admin' && !closed && <>
      <div hidden={view !== 'import'}><Suspense fallback={<p role="status">Cargando importación CSV…</p>}><TicketImport eventId={eventId} types={types} disabled={busy || loading || !!pending || !!action || (!!result && !saved)} onProtectedChange={setImportPending} onChanged={() => { setRevision(v => v + 1); onChanged?.(); }}/></Suspense></div>
      <div hidden={view !== 'types'}><TicketTypePrices eventId={eventId} types={types} disabled={busy || loading || !!pending || !!action || importPending || (!!result && !saved)} onPendingChange={setPricesPending} onChanged={() => { setRevision(v => v + 1); onChanged?.(); }}/></div>
      <div hidden={view !== 'issue'}>{result ? <div className="issued-ticket">
        <h3>{result.entries.length === 1 ? 'Entrada emitida' : result.entries.length + ' entradas emitidas'}</h3><p>{result.name}</p>
        <div className="purchase-qrs">{result.entries.map((entry, i) => <figure key={entry.id}><img src={entry.qr} alt={`Código QR de entrada ${i + 1}`} width={200} height={200}/><figcaption>Entrada {i + 1} de {result.entries.length}</figcaption></figure>)}</div>
        <p className="ticket-id">{result.id}</p>
        <a className="btn primary download-qr" href={result.url || result.qr} download={`santos-rock-${result.id}.${result.url ? 'zip' : 'png'}`}>{result.url ? 'Descargar todos los QR (ZIP)' : 'Descargar QR'}</a>
        <p>{result.entries.length === 1 ? 'Guarde el QR antes de salir.' : 'Guarde el ZIP antes de salir y entregue un QR diferente a cada acompañante.'}</p>
        {result.email ? <SendTicketEmail items={result.entries.map(entry => ({ ticket_id: entry.id, token: entry.token, recipient: result.email }))} autoQueue={result.sendEmail} onPendingChange={setEmailPending}/> : <p>No se indicó correo del titular. Puede entregar el QR descargado manualmente.</p>}
        <label className="saved-check"><input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)}/> {result.entries.length === 1 ? 'Confirmo que guardé el QR' : 'Confirmo que guardé todos los QR'}</label>
        <button className="btn quiet" disabled={!saved || emailPending} onClick={() => { if (qrUrl.current) URL.revokeObjectURL(qrUrl.current); qrUrl.current = null; setResult(null); setQuantity(1); setEmailDraft(''); setSendEmail(false); }}>Emitir otra entrada</button>
      </div>
      : pending ? <div className="notice"><p>La solicitud está pendiente de confirmación. Conserve esta pantalla abierta.</p><button className="btn quiet" disabled={busy} onClick={() => send(pending)}>{busy ? 'Confirmando…' : 'Reintentar la misma emisión'}</button></div>
      : types.length > 0 && <form onSubmit={issue} className="issue-form"><h3>Emitir entradas</h3><fieldset disabled={busy || loading || !!action || importPending}><label>Tipo<select name="type" value={selectedType || types[0]?.id || ''} onChange={e => setSelectedType(e.target.value)} required>{types.map(type => <option key={type.id} value={type.id}>{type.name} · {pricing(type).known ? crc(pricing(type).total) : 'Sin precio registrado'}</option>)}</select></label><label>Cantidad de entradas<input type="number" min={1} max={100} step={1} value={quantity} onChange={e => setQuantity(Number(e.target.value))} required/></label><PriceBreakdown price={selectedPrice} quantity={quantity}/><label>Nombre del titular<input name="holder" required minLength={2} maxLength={160}/></label><label>Correo (opcional)<input name="email" type="email" maxLength={254} value={emailDraft} onChange={e => { setEmailDraft(e.target.value); setSendEmail(false); }}/></label>{emailDraft.trim() && <EmailDeliveryChoice recipients={[emailDraft.trim()]} checked={sendEmail} onChange={setSendEmail}/>}<label>Origen<select value={effectiveSource} onChange={e => setSource(e.target.value)}>{Object.entries(sources).filter(([value]) => !['door', 'ticketera'].includes(value)).map(([value, name]) => <option key={value} value={value} disabled={(value === 'complimentary' && selectedPrice.paid) || (value === 'door' && selectedPrice.transport > 0)}>{name}</option>)}</select></label>{(effectiveSource === 'sinpe' || effectiveSource === 'door' || selectedPrice.paid) && <><label className="saved-check"><input type="checkbox" checked={paymentConfirmed} onChange={e => setPaymentConfirmed(e.target.checked)} required/> Verifiqué el pago antes de emitir esta entrada</label></>}<button className="btn primary">{busy ? 'Emitiendo…' : quantity === 1 ? 'Emitir entrada y generar QR' : `Emitir ${quantity} entradas y generar QR`}</button></fieldset></form>}
      {!loading && !types.length && <p>Para emitir entradas, agregue primero un tipo en «Tipos de entrada».</p>}</div>
    </>}
    {loading && tickets.length > 0 && <p role="status">Actualizando entradas…</p>}
    {closed && <p>Este evento está cerrado o cancelado; no admite nuevas emisiones.</p>}
    <div hidden={view !== 'list'}><div className="form-heading"><h3>Entradas emitidas</h3><button className="btn quiet" disabled={busy || loading} onClick={() => setRevision(v => v + 1)}>Actualizar</button></div>{loading && !tickets.length ? <p role="status">Cargando entradas…</p> : tickets.length ? <div className="ticket-table"><table aria-busy={loading}><thead><tr><SortHeader column="full_name" sort={tableSort} onSort={sortTickets} disabled={loading || busy}>Titular</SortHeader><SortHeader column="type_name" sort={tableSort} onSort={sortTickets} disabled={loading || busy}>Tipo</SortHeader><SortHeader column="source" sort={tableSort} onSort={sortTickets} disabled={loading || busy}>Origen</SortHeader><SortHeader column="status" sort={tableSort} onSort={sortTickets} disabled={loading || busy}>Estado</SortHeader><SortHeader column="issued_at" sort={tableSort} onSort={sortTickets} disabled={loading || busy}>Emitida</SortHeader>{permission === 'admin' && <th>Acciones</th>}</tr></thead><tbody>{tickets.map(ticket => <tr key={ticket.id}><td title={ticket.id}>{ticket.full_name}</td><td>{ticket.type_name}</td><td>{sources[ticket.source] || ticket.source}</td><td><span className={'status-badge status-' + ticket.status}>{statuses[ticket.status] || ticket.status}</span></td><td>{new Intl.DateTimeFormat('es-CR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Costa_Rica' }).format(new Date(ticket.issued_at))}</td>{permission === 'admin' && <td>{ticket.status === 'issued' && ticket.source !== 'ticketera' ? <div className="ticket-row-actions"><button className="btn quiet" disabled={busy || loading || importPending || !!pending || (!!result && !saved) || !!action || closed} onClick={() => { setResult(null); setAction({ ticket, action: 'reissue' }); }}>Reemitir QR</button><button className="btn quiet" disabled={busy || loading || importPending || !!pending || (!!result && !saved) || !!action} onClick={() => { setResult(null); setAction({ ticket, action: 'void' }); }}>Anular</button></div> : '—'}</td>}</tr>)}</tbody></table></div> : <p>No hay entradas para mostrar.</p>}
    {action && <Suspense fallback={<p role="status">Cargando acciones de la entrada…</p>}><TicketActions key={action.ticket.id + action.action} ticket={action.ticket} action={action.action} onClose={() => setAction(null)} onChanged={() => { setRevision(v => v + 1); onChanged?.(); }} onPendingChange={setActionPending}/></Suspense>}
    <div className="ticket-pagination"><button className="btn quiet" disabled={busy || loading || page === 0} onClick={() => setPage(v => v - 1)}>Anterior</button><span>Página {page + 1}</span><button className="btn quiet" disabled={busy || loading || tickets.length < 20} onClick={() => setPage(v => v + 1)}>Siguiente</button></div></div>
  </section>;
}

function PriceBreakdown({ price, quantity = 1 }: { price: ReturnType<typeof pricing>; quantity?: number }) {
  return price.known ? <dl className="price-breakdown"><div><dt>Concierto</dt><dd>{crc(price.admission * quantity)}</dd></div>{price.transport > 0 && <div><dt>Transporte</dt><dd>{crc(price.transport * quantity)}</dd></div>}<div><dt>Total</dt><dd>{crc(price.total * quantity)}</dd></div></dl> : <p>Este tipo aún no tiene precio. Su emisión no registrará un importe de venta.</p>;
}
