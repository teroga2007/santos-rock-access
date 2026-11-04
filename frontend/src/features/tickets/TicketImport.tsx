import { EmailDeliveryChoice } from '../mail/EmailDeliveryChoice';
import { SortHeader, useTableSort } from '../../components/tableSort';
import { useEffect, useMemo, useRef, useState } from 'react';
import { parseTicketCsv, type ImportRow } from './csvImport';
import { supabase } from '../../lib/supabase';
import Papa from 'papaparse';
import { SendTicketEmail } from '../mail/SendTicketEmail';
import { crc, pricing, type PricedTicketType } from './ticketPricing';

type PayloadRow = ImportRow & { token: string };
type Pending = { args: { p_event_id: string; p_type_id: string; p_source: string; p_batch_id: string; p_rows: PayloadRow[]; p_expected_price_crc: number | null; p_expected_transport_crc: number }; url: string; count: number; sendEmail: boolean };
export function TicketImport({ eventId, types, disabled, onProtectedChange, onChanged }: {
  eventId: string; types: PricedTicketType[]; disabled: boolean;
  onProtectedChange: (value: boolean) => void; onChanged: () => void;
}) {
  const [text, setText] = useState('');
  const [filename, setFilename] = useState('');
  const [source, setSource] = useState('sinpe');
  const [typeId, setTypeId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [result, setResult] = useState<(Pending & { tickets: { row: number; ticket_id: string }[] }) | null>(null);
  const [saved, setSaved] = useState(false);
  const [sendEmail, setSendEmail] = useState(false);
  const [emailPending, setEmailPending] = useState(false);
  useEffect(() => { setSendEmail(false); }, [text]);
  const lock = useRef(false);
  const urlRef = useRef<string | null>(null);
  const fileVersion = useRef(0);
  const selectedPrice = pricing(types.find(t => t.id === (typeId || types[0]?.id)));
  useEffect(() => { if (selectedPrice.paid && source === 'complimentary') setSource('sinpe'); }, [selectedPrice.paid, source]);
  const { rows, errors } = useMemo(() => text ? parseTicketCsv(text, source, selectedPrice.paid) : { rows: [], errors: [] }, [text, source, selectedPrice.paid]);
  const protectedState = busy || !!pending || (!!result && !saved) || emailPending;
  useEffect(() => { if (!protectedState && typeId && !types.some(type => type.id === typeId)) { setTypeId(''); setConfirmed(false); } }, [types, typeId, protectedState]);
  useEffect(() => { setConfirmed(false); }, [text, source, typeId]);
  useEffect(() => { onProtectedChange(protectedState); return () => onProtectedChange(false); }, [protectedState, onProtectedChange]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    if (protectedState) window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [protectedState]);
  useEffect(() => () => { fileVersion.current++; if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  async function load(file: File) {
    if (disabled || protectedState) return;
    const version = ++fileVersion.current;
    setError(''); setText(''); setFilename('');
    if (file.size > 1000000) { setError('El CSV debe pesar como máximo 1 MB.'); return; }
    try {
      const value = await file.text();
      if (version !== fileVersion.current) return;
      setText(value); setFilename(file.name);
      if (!value.trim()) setError('El archivo está vacío.');
    } catch { if (version === fileVersion.current) setError('No se pudo leer el archivo.'); }
  }

  async function send(request: Pending) {
    if (!supabase || lock.current) return;
    lock.current = true; setBusy(true); setError(''); setProgress('Confirmando importación…');
    try {
      const { data, error } = await supabase.rpc('import_priced_native_tickets', request.args);
      if (error) {
        const definitive = ['42501','23514','23505','22023','23503','PGRST202','P0001'].includes(error.code);
        setError(error.code === 'P0001' ? 'La tarifa cambió. Actualice las entradas y revise los pagos antes de importar.' : error.code === '23505' ? 'Este contenido ya fue importado, o una credencial ya existe. No se agregó ninguna entrada. Revise el listado.' : error.code === '23514' ? 'No hay cupo suficiente, el evento está cerrado o el tipo no corresponde. No se importó ninguna fila.' : error.code === '42501' ? 'No tiene permiso para importar entradas en este evento.' : error.code === '22023' ? 'Revise las filas, los nombres y las referencias de pago. No se importó ninguna fila.' : error.code === 'PGRST202' ? 'Falta habilitar la importación en la base de datos.' : 'No se pudo confirmar el lote. Conserve esta pantalla y reintente la misma importación.');
        if (definitive) { setPending(null); URL.revokeObjectURL(request.url); urlRef.current = null; }
        return;
      }
      if (!Array.isArray(data) || data.length !== request.count) { setError('Respuesta inesperada. Reintente el mismo lote para confirmar el resultado.'); return; }
      setResult({ ...request, tickets: data }); setPending(null); setSaved(false); onChanged();
    } catch { setError('Sin confirmación del servidor. No entregue los QR todavía; reintente el mismo lote.'); }
    finally { lock.current = false; setBusy(false); setProgress(''); }
  }

  async function prepare() {
    const selectedType = typeId || types[0]?.id;
    if (lock.current || disabled || pending || result || !confirmed || errors.length || !rows.length || !types.some(t => t.id === selectedType)) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const [{ default: QRCode }, { zipSync, strToU8 }] = await Promise.all([import('qrcode'), import('fflate')]);
      const batchId = crypto.randomUUID();
      const payload: PayloadRow[] = [];
      const archive: Record<string, Uint8Array> = {};
      const manifest: Record<string, string | number>[] = [];
      for (let i = 0; i < rows.length; i++) {
        setProgress(`Preparando QR ${i + 1} de ${rows.length}…`);
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        const token = 'sra1_' + btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
        const qr = await QRCode.toDataURL(token, { width: 600, margin: 4, errorCorrectionLevel: 'M' });
        const file = `${String(i + 1).padStart(3,'0')}.png`;
        archive[file] = Uint8Array.from(atob(qr.split(',')[1]), value => value.charCodeAt(0));
        payload.push({ ...rows[i], token });
        manifest.push({ fila: i + 1, nombre: rows[i].name, correo: rows[i].email, referencia: rows[i].reference, archivo: file, lote: batchId, evento: eventId, tipo: types.find(t => t.id === selectedType)!.name, origen: source });
      }
      archive['personas.csv'] = strToU8('\uFEFF' + Papa.unparse(manifest, { escapeFormulae: true }));
      const zip = zipSync(archive, { level: 0 });
      const url = URL.createObjectURL(new Blob([zip.slice().buffer as ArrayBuffer], { type: 'application/zip' }));
      urlRef.current = url;
      const request: Pending = { url, count: rows.length, sendEmail, args: { p_event_id: eventId, p_type_id: selectedType, p_source: source, p_batch_id: batchId, p_rows: payload, p_expected_price_crc: selectedPrice.known ? selectedPrice.admission : null, p_expected_transport_crc: selectedPrice.transport } };
      setPending(request); lock.current = false; await send(request);
    } catch { setError('No se pudo preparar el archivo de QR. Vuelva a intentar o contacte al administrador.'); }
    finally { lock.current = false; setBusy(false); setProgress(''); }
  }

  function clear() {
    if (protectedState) return;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null; setResult(null); setPending(null); setText(''); setFilename(''); setError(''); setSaved(false); setConfirmed(false);
  }

  const previewSort = useTableSort(rows.map((row,index) => ({ ...row, line: index + 2 })), { line: r => r.line, name: r => r.name, email: r => r.email || null, reference: r => r.reference || null });
  return <section className="import-panel"><h3>Importar desde CSV</h3><p>Hasta 100 personas por archivo, con el mismo tipo y origen. Una entrada por fila.</p>
    {error && <p className="notice" role="alert">{error}</p>}{progress && <p role="status">{progress}</p>}
    {result ? <div className="issued-ticket">
      <h3>{result.count} entradas importadas</h3><p className="ticket-id">Lote: {result.args.p_batch_id}</p>
      <a className="btn primary download-qr" href={result.url} download={`santos-rock-${result.args.p_batch_id}.zip`}>Descargar todos los QR (ZIP)</a>
      <p>El ZIP contiene un PNG por persona y personas.csv para relacionar nombres, correos y archivos.</p>
      <SendTicketEmail items={result.tickets.filter(ticket => result.args.p_rows[ticket.row - 1]?.email).map(ticket => ({ ticket_id: ticket.ticket_id, token: result.args.p_rows[ticket.row - 1].token, recipient: result.args.p_rows[ticket.row - 1].email }))} autoQueue={result.sendEmail} onPendingChange={setEmailPending}/>
      <p>Las entradas sin correo se entregan manualmente.</p>
      <label className="saved-check"><input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)}/> Confirmo que guardé el ZIP</label>
      <button className="btn quiet" disabled={!saved || emailPending} onClick={clear}>Preparar otro lote</button>
    </div>
    : pending ? <div className="notice"><p>El lote está pendiente de confirmación. No cierres esta pantalla.</p><button className="btn quiet" disabled={busy} onClick={() => send(pending)}>{busy ? 'Confirmando…' : 'Reintentar la misma importación'}</button></div>
    : <><a className="btn quiet template-link" download="plantilla-santos-rock.csv" href={'data:text/csv;charset=utf-8,' + encodeURIComponent('\uFEFFnombre,correo,referencia\r\nPersona de ejemplo,persona@example.com,REF-EJEMPLO\r\n')}>Descargar plantilla CSV</a><fieldset disabled={disabled || busy}>
      <label>Tipo de entrada<select value={typeId || types[0]?.id || ''} onChange={e => setTypeId(e.target.value)}><option value="" disabled>Cree un tipo de entrada primero</option>{types.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
      <p>{selectedPrice.known ? `Por persona: concierto ${crc(selectedPrice.admission)} · transporte ${crc(selectedPrice.transport)} · total ${crc(selectedPrice.total)}` : 'Sin precio configurado: este lote no registrará importes de venta.'}</p><label>Origen<select value={source} onChange={e => setSource(e.target.value)}><option value="sinpe">SINPE</option><option value="complimentary" disabled={selectedPrice.paid}>Cortesías / acreditaciones</option><option value="other">Otro</option></select></label>
      <label>Archivo CSV (UTF-8, máximo 1 MB)<input type="file" accept=".csv,text/csv" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void load(file); }}/></label>
      {text && <><p>{filename} · {rows.length} personas{selectedPrice.known && ` · Total del lote: ${crc(selectedPrice.total * rows.length)}`}</p>{errors.length > 0 && <div className="notice" role="alert"><ul>{errors.slice(0,20).map((error, i) => <li key={i}>{error}</li>)}</ul>{errors.length > 20 && <p>Hay más errores; corrija el archivo antes de continuar.</p>}</div>}<div className="ticket-table import-preview"><table><thead><tr><SortHeader column="line" sort={previewSort.sort} onSort={previewSort.toggle}>Fila</SortHeader><SortHeader column="name" sort={previewSort.sort} onSort={previewSort.toggle}>Nombre</SortHeader><SortHeader column="email" sort={previewSort.sort} onSort={previewSort.toggle}>Correo</SortHeader><SortHeader column="reference" sort={previewSort.sort} onSort={previewSort.toggle}>Referencia</SortHeader></tr></thead><tbody>{previewSort.rows.map(row => <tr key={row.line}><td>{row.line}</td><td>{row.name}</td><td>{row.email || '—'}</td><td>{row.reference || '—'}</td></tr>)}</tbody></table></div>{!errors.length && rows.some(row => row.email) && <EmailDeliveryChoice recipients={rows.filter(row => row.email).map(row => row.email)} checked={sendEmail} onChange={setSendEmail} bulk/>}<label className="saved-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/> Revisé las personas y {source === 'sinpe' || selectedPrice.paid ? 'verifiqué todos los pagos' : 'autorizo estas entradas'}. Cada fila representa una persona distinta.</label><button className="btn primary" disabled={busy || disabled || !confirmed || !!errors.length || !rows.length || !types.length} onClick={prepare}>Importar {rows.length} personas y generar sus QR</button></>}
    </fieldset></>}
  </section>;
}
