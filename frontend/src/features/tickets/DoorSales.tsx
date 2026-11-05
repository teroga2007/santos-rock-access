import { preparePurchaseQr, type PurchaseQr } from './purchaseQr';
import { EmailDeliveryChoice } from '../mail/EmailDeliveryChoice';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { RefreshCw, Ticket } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { crc, pricing, type PricedTicketType } from './ticketPricing';
import { SendTicketEmail } from '../mail/SendTicketEmail';

const methods = { cash: 'Efectivo', sinpe: 'SINPE', card: 'Tarjeta', other: 'Otro' };
type Method = keyof typeof methods;
type Request = { p_event_id: string; p_type_id: string; p_request_id: string; p_token: string; p_full_name: string; p_email: string | null; p_payment_method: Method; p_payment_reference: string | null; p_cash_received_crc: number | null; p_payment_confirmed: boolean; p_expected_price_crc: number };
type Pending = { args: Request; qr: string; entries: PurchaseQr[]; url: string | null; sendEmail: boolean };
type Sale = Pending & { ticketIds: string[]; ticketId: string; total: number; change: number | null };
function failure(code?: string) {
  return code === '42501' ? 'Su cuenta no tiene permiso para vender entradas.' : code === 'P0001' ? 'La tarifa cambió. Revise el nuevo total y confirme el pago nuevamente.' : code === '23514' ? 'El evento no admite ventas o el tipo de entrada está lleno.' : code === '22023' ? 'Revise el pago recibido, la cantidad y los datos del comprador.' : 'No se pudo confirmar la venta. Reintente la misma solicitud antes de cobrar nuevamente.';
}

export function DoorSales({ eventId, eventStatus, onPendingChange, onChanged }: { eventId: string; eventStatus: string; onPendingChange: (pending: boolean) => void; onChanged: () => void }) {
  const [types, setTypes] = useState<PricedTicketType[]>([]);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState('');
  const [method, setMethod] = useState<Method>('cash');
  const [name, setName] = useState(''); const [email, setEmail] = useState('');
  const [cash, setCash] = useState('');
  const [quantity, setQuantity] = useState(1);
  const qrUrl = useRef<string | null>(null);
  useEffect(() => () => { if (qrUrl.current) URL.revokeObjectURL(qrUrl.current); }, []);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [sale, setSale] = useState<Sale | null>(null);
  const [saved, setSaved] = useState(false);
  const [sendEmail, setSendEmail] = useState(false);
  const [emailPending, setEmailPending] = useState(false);
  const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const lock = useRef(false);
  const receiptHeading = useRef<HTMLHeadingElement>(null);
  const buyerInput = useRef<HTMLInputElement>(null);
  const allowed = eventStatus === 'published' || eventStatus === 'live';
  const selectedId = selected || types.find(type => Number(type.price_crc) === 16000 && !Number(type.transport_price_crc))?.id || '';
  const type = types.find(type => type.id === selectedId);
  const price = pricing(type);
  const total = price.admission * quantity;
  const change = cash !== '' && Number(cash) >= total ? Math.round((Number(cash) - total) * 100) / 100 : null;
  const protectedState = busy || !!pending || (!!sale && !saved) || emailPending;
  useEffect(() => { if (sale) { receiptHeading.current?.focus(); receiptHeading.current?.scrollIntoView({ block: 'center' }); } }, [sale]);
  useEffect(() => { onPendingChange(protectedState); return () => onPendingChange(false); }, [protectedState, onPendingChange]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    if (protectedState) window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [protectedState]);
  useEffect(() => { setConfirmed(false); }, [selectedId, method, cash, quantity, price.admission]);
  useEffect(() => {
    if (!supabase) return;
    const client = supabase; let active = true; setLoading(true); setError('');
    Promise.resolve(client.from('ticket_types').select('id,name,price_crc,transport_price_crc,category,capacity,access_zone').eq('event_id', eventId).order('created_at')).then(ticketTypes => {
      if (!active) return;
      if (ticketTypes.error) { setError('No se pudieron consultar las tarifas. Vuelva a intentar.'); setTypes([]); return; }
      const eligible = (ticketTypes.data || []).filter(type => type.category === 'admission' && pricing(type).known && Number(type.price_crc) > 0 && Number(type.transport_price_crc) === 0);
      setTypes(eligible); setSelected(current => eligible.some(type => type.id === current) ? current : eligible.find(type => Number(type.price_crc) === 16000)?.id || '');
    }).catch(() => { if (active) { setError('No se pudo conectar para consultar las tarifas.'); setTypes([]); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [eventId, revision]);

  async function send(request: Pending) {
    if (!supabase || lock.current) return;
    lock.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const { data, error } = await supabase.rpc('issue_ticket_purchases', { p_event_id: eventId, p_type_id: request.args.p_type_id, p_request_id: request.args.p_request_id, p_rows: [{ name: request.args.p_full_name, email: request.args.p_email, quantity: request.entries.length, tokens: request.entries.map(entry => entry.token) }], p_source: 'door', p_expected_price_crc: request.args.p_expected_price_crc, p_expected_transport_crc: 0, p_payment_confirmed: request.args.p_payment_confirmed, p_import: false, p_payment_method: request.args.p_payment_method, p_cash_received_crc: request.args.p_cash_received_crc });
      if (error) {
        setError(failure(error.code));
        if (['42501','P0001','23514','22023','23505','PGRST202'].includes(error.code)) { setPending(null); if (request.url) URL.revokeObjectURL(request.url); qrUrl.current = null; }
        if (error.code === 'P0001') { setConfirmed(false); setRevision(value => value + 1); setMessage('La venta no se registró. Revise las tarifas actualizadas antes de continuar.'); }
        return;
      }
      if (!Array.isArray(data?.tickets) || data.tickets.length !== request.entries.length || !Number.isFinite(Number(data.total_crc)) || (data.cash_change_crc !== null && !Number.isFinite(Number(data.cash_change_crc)))) { setError('Respuesta incompleta. Reintente la misma venta para confirmar el resultado.'); return; }
      setSale({ ...request, ticketIds: data.tickets.map((ticket: { ticket_id: string }) => ticket.ticket_id), ticketId: data.tickets[0].ticket_id, total: Number(data.total_crc), change: data.cash_change_crc === null ? null : Number(data.cash_change_crc) });
      setPending(null); setSaved(false); onChanged();
    } catch { setError(failure()); }
    finally { lock.current = false; setBusy(false); }
  }
  async function submit(e: FormEvent) {
    e.preventDefault(); if (lock.current || busy || pending || sale || !type || !allowed || !confirmed) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const prepared = await preparePurchaseQr(quantity);
      qrUrl.current = prepared.url;
      const { token, qr } = prepared.entries[0];
      const request: Pending = { qr, entries: prepared.entries, url: prepared.url, sendEmail: sendEmail && !!email.trim(), args: { p_event_id: eventId, p_type_id: type.id, p_request_id: crypto.randomUUID(), p_token: token,
        p_full_name: name.trim(), p_email: email.trim() || null,
        p_payment_method: method, p_payment_reference: null,
        p_cash_received_crc: method === 'cash' ? Number(cash) : null, p_payment_confirmed: confirmed,
        p_expected_price_crc: price.admission } };
      setPending(request); lock.current = false; await send(request);
    } catch { setError('No se pudo preparar el QR. Vuelva a intentar.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="details-panel door-sales" aria-label="Venta en puerta"><div className="form-heading"><h2>Venta en puerta</h2><button className="btn quiet" disabled={protectedState || loading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={16}/> Actualizar tarifas</button></div>
    {error && <p className="notice" role="alert">{error}</p>}{message && <p className="created-message" role="status">{message}</p>}
    {!allowed && <p className="notice">{eventStatus === 'draft' ? 'Publique el evento para habilitar las ventas.' : 'Este evento ya no admite ventas.'}</p>}
    {loading && <p role="status">Consultando tarifas…</p>}
    {sale ? <div className="issued-ticket"><h3 ref={receiptHeading} tabIndex={-1}>Venta registrada</h3><p>{sale.args.p_full_name} · {methods[sale.args.p_payment_method]}</p>
      <dl className="price-breakdown"><div><dt>Concierto</dt><dd>{crc(sale.args.p_expected_price_crc * sale.entries.length)}</dd></div><div><dt>Total cobrado</dt><dd>{crc(sale.total)}</dd></div></dl>
      {sale.change !== null && <p className="door-change">Vuelto: <strong>{crc(sale.change)}</strong></p>}
      <p>{sale.entries.length} entrada(s), cada una con su propio QR.</p><div className="purchase-qrs">{sale.entries.map((entry, i) => <figure key={i}><img src={entry.qr} alt={`QR de entrada ${i + 1} vendida en puerta`} width={200} height={200}/><figcaption>Entrada {i + 1}</figcaption></figure>)}</div>
      <a className="btn primary download-qr" href={sale.url || sale.qr} download={`santos-rock-${sale.ticketId}.${sale.url ? 'zip' : 'png'}`}>{sale.url ? 'Descargar todos los QR (ZIP)' : 'Descargar QR'}</a>
      {sale.args.p_email && <SendTicketEmail items={sale.entries.map((entry, i) => ({ ticket_id: sale.ticketIds[i], token: entry.token, recipient: sale.args.p_email }))} autoQueue={sale.sendEmail} onPendingChange={setEmailPending}/>}
      <p>Entregue el QR. El ingreso se confirma después en el escáner.</p>
      <label className="saved-check"><input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)}/> Confirmo que guardé o entregué el QR</label>
      <button className="btn primary" disabled={!saved || emailPending} onClick={() => { setSendEmail(false); setSale(null); setSaved(false); setName(''); setEmail(''); setCash(''); setQuantity(1); if (qrUrl.current) URL.revokeObjectURL(qrUrl.current); qrUrl.current = null; setConfirmed(false); requestAnimationFrame(() => buyerInput.current?.focus()); }}>Siguiente venta</button>
    </div> : pending ? <div className="notice"><p>La venta está pendiente de confirmación. Conserve esta pantalla y no vuelva a cobrar.</p><button className="btn quiet" disabled={busy} onClick={() => send(pending)}>{busy ? 'Confirmando…' : 'Reintentar la misma venta'}</button></div> : <>
      {!loading && !types.length && !error && <p>Configure una tarifa de concierto en Entradas → Tipos de entrada para vender en puerta.</p>}
      {!!types.length && <form onSubmit={submit}><fieldset disabled={!allowed || loading || busy}>
        <label>Entrada<select value={selectedId} required onChange={e => setSelected(e.target.value)}><option value="" disabled>Seleccione una tarifa</option>{types.map(type => <option key={type.id} value={type.id}>{type.name} · {crc(pricing(type).total)}</option>)}</select></label>
        <label>Cantidad de entradas<input type="number" min={1} max={100} step={1} required value={quantity} onChange={e => setQuantity(Number(e.target.value))}/></label><dl className="price-breakdown" aria-label="Importe de la venta"><div><dt>Concierto</dt><dd>{crc(total)}</dd></div><div><dt>Total por cobrar</dt><dd>{crc(total)}</dd></div></dl>
        <label>Nombre del titular<input ref={buyerInput} value={name} onChange={e => setName(e.target.value)} minLength={2} maxLength={160} required autoComplete="off"/></label>
        <label>Medio de pago<select value={method} onChange={e => setMethod(e.target.value as Method)}>{Object.entries(methods).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        {method === 'cash' ? <><label>Efectivo recibido (CRC)<input type="number" inputMode="decimal" value={cash} onChange={e => setCash(e.target.value)} min={total} max={999999999999.99} step="0.01" required/></label><p className="door-change" role="status">Vuelto: <strong>{change === null ? '—' : crc(change)}</strong></p></> : null}
        <details className="door-email"><summary>Agregar correo del titular</summary><label>Correo (opcional)<input value={email} onChange={e => { setEmail(e.target.value); setSendEmail(false); }} type="email" maxLength={254} autoComplete="off"/></label>{email.trim() && <EmailDeliveryChoice recipients={[email.trim()]} checked={sendEmail} onChange={setSendEmail}/>}</details>
        <label className="saved-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} required/> Verifiqué y recibí el pago</label>
        <button className="btn primary" disabled={!type || !confirmed || (method === 'cash' && change === null)}><Ticket size={18}/>{busy ? 'Registrando…' : `Registrar venta · ${crc(total)}`}</button>
      </fieldset></form>}
    </>}
  </section>;
}
