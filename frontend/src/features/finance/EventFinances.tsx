import { SortHeader, useTableSort } from '../../components/tableSort';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { crc } from '../tickets/ticketPricing';

type Totals = {
  sold: number; transport_count: number; free: number; admission_crc: number; transport_crc: number; gross_crc: number;
  without_amount: number; issued: number; admitted: number; pending: number; voided: number; voided_paid: number;
  unverified: number; cancelled: number; refunded: number;
};
type Row = { type_id: string; type_name: string; kind: string; source: string; payment_status: string; unit_price_crc: number; quantity: number; gross_crc: number };
type Finance = { generated_at: string; currency: string; totals: Totals; breakdown: Row[]; sources: { source: string; sold: number; admission_crc: number; transport_crc: number; gross_crc: number }[]; types: { id: string; name: string }[]; payment_methods?: { method: string; gross_crc: number }[] };
const sources: Record<string, string> = { sinpe: 'SINPE', door: 'Puerta', ticketera: 'La Tiquetera', complimentary: 'Cortesía / acreditación', other: 'Otro' };
const concepts: Record<string, string> = { admission: 'Concierto', transport: 'Transporte', accreditation: 'Acreditación' };
const paymentStates: Record<string, string> = { verified: 'Verificado', pending: 'Por verificar', cancelled: 'Cancelado', refunded: 'Reembolsado' };
const paymentMethods: Record<string, string> = { cash: 'Efectivo', sinpe: 'SINPE', card: 'Tarjeta', other: 'Otro', unknown: 'Sin registrar' };
const emptyFilters = { from: '', to: '', type: '', source: '' };

export function EventFinances({ eventId }: { eventId: string }) {
  const [filters, setFilters] = useState(emptyFilters);
  const [applied, setApplied] = useState(emptyFilters);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<Finance | null>(null);
  const [types, setTypes] = useState<Finance['types']>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [exporting, setExporting] = useState(false);
  const sourceSort = useTableSort(data?.sources || [], { source: r => sources[r.source] || r.source, admission: r => Number(r.admission_crc), transport: r => Number(r.transport_crc), gross: r => Number(r.gross_crc) });
  const detailSort = useTableSort(data?.breakdown || [], { type: r => r.type_name, kind: r => concepts[r.kind] || r.kind, source: r => sources[r.source] || r.source, payment: r => paymentStates[r.payment_status] || r.payment_status, quantity: r => Number(r.quantity), price: r => Number(r.unit_price_crc), gross: r => Number(r.gross_crc) });
  const paymentSort = useTableSort(data?.payment_methods || [], { method: r => paymentMethods[r.method] || r.method, gross: r => Number(r.gross_crc) });
  useEffect(() => {
    if (!supabase) return;
    const client = supabase; const controller = new AbortController(); let active = true;
    setBusy(true); setError(''); setData(null);
    async function load() {
      try {
        const { data: result, error } = await client.rpc('get_event_finances', {
          p_event_id: eventId, p_from: applied.from || null, p_to: applied.to || null,
          p_type_id: applied.type || null, p_source: applied.source || null,
        }).abortSignal(controller.signal);
        if (!active) return;
        if (error) { setError(error.code === '42501' ? 'Su cuenta no tiene acceso a las finanzas de este evento.' : error.code === '22023' ? 'Revise el rango de fechas y el tipo de entrada.' : 'No se pudieron cargar las finanzas. Vuelva a intentar.'); return; }
        if (!result?.totals || !Array.isArray(result.breakdown) || !Array.isArray(result.sources) || !Array.isArray(result.types)) {
          setError('El resumen financiero no está disponible. Vuelva a intentar.'); return;
        }
        setData(result as Finance); setTypes(result.types);
      } catch { if (active) setError('No se pudo conectar para consultar las finanzas.'); }
      finally { if (active) setBusy(false); }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [eventId, applied, revision]);

  const chart = useMemo(() => {
    const rows = new Map<string, { name: string; amount: number }>();
    for (const row of data?.breakdown || []) {
      if (row.kind !== 'admission' || Number(row.gross_crc) <= 0) continue;
      const key = row.type_id + ':' + row.type_name;
      const previous = rows.get(key) || { name: row.type_name, amount: 0 };
      previous.amount += Number(row.gross_crc); rows.set(key, previous);
    }
    return [...rows.values()].sort((a, b) => b.amount - a.amount);
  }, [data]);
  const chartMax = Math.max(1, ...chart.map(row => row.amount));
  const changed = Object.keys(filters).some(key => filters[key as keyof typeof filters] !== applied[key as keyof typeof applied]);
  function apply(e: FormEvent) {
    e.preventDefault(); setFormError('');
    if (filters.from && filters.to && filters.from > filters.to) { setFormError('La fecha final debe ser igual o posterior a la inicial.'); return; }
    setApplied({ ...filters });
  }
  async function download() {
    if (!data || exporting) return;
    setExporting(true); setFormError('');
    try {
      const { default: Papa } = await import('papaparse');
      const csv = Papa.unparse(detailSort.rows.map(row => ({
        tipo: row.type_name, concepto: concepts[row.kind] || row.kind, origen: sources[row.source] || row.source,
        estado_pago: paymentStates[row.payment_status] || row.payment_status, cantidad: row.quantity,
        precio_unitario_crc: row.unit_price_crc, ingreso_bruto_verificado_crc: row.gross_crc,
      })), { escapeFormulae: true });
      const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `finanzas-${eventId}.csv`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setFormError('No se pudo preparar el CSV. Vuelva a intentar.'); }
    finally { setExporting(false); }
  }
  return <section className="details-panel finance-panel" aria-label="Finanzas del evento">
    <div className="form-heading"><div><h2>Finanzas</h2><p>Ingresos brutos de pagos verificados · CRC</p></div><div className="scanner-actions"><button className="btn quiet" disabled={busy} onClick={() => setRevision(value => value + 1)}><RefreshCw size={16}/> Actualizar</button><button className="btn quiet" disabled={busy || !data?.breakdown.length || exporting || changed} onClick={download}><Download size={16}/>{exporting ? 'Preparando…' : 'Exportar CSV'}</button></div></div>
    <form className="finance-filters" onSubmit={apply}><fieldset disabled={busy}><label>Desde<input type="date" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })}/></label><label>Hasta<input type="date" value={filters.to} min={filters.from || undefined} onChange={e => setFilters({ ...filters, to: e.target.value })}/></label><label>Tipo de entrada<select value={filters.type} onChange={e => setFilters({ ...filters, type: e.target.value })}><option value="">Todos los tipos</option>{types.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label><label>Origen de venta<select value={filters.source} onChange={e => setFilters({ ...filters, source: e.target.value })}><option value="">Todos los orígenes</option>{Object.entries(sources).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><button className="btn primary">Aplicar filtros</button><button className="btn quiet" type="button" onClick={() => { setFilters(emptyFilters); setApplied(emptyFilters); setFormError(''); }}>Limpiar</button></fieldset></form>
    <p className="dashboard-updated">Fechas de emisión en hora de Costa Rica.{changed && ' Hay filtros sin aplicar.'}</p>
    {formError && <p className="notice" role="alert">{formError}</p>}
    {busy && <p role="status">Consultando finanzas…</p>}
    {error && <div className="notice" role="alert">{error}<button className="btn quiet" onClick={() => setRevision(value => value + 1)}>Reintentar</button></div>}
    {data && <>
      <p className="dashboard-updated">Actualizado: {new Intl.DateTimeFormat('es-CR', { timeZone: 'America/Costa_Rica', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(data.generated_at))}</p>
      {!!data.totals.without_amount && <p className="notice" role="status">{data.totals.without_amount} entradas sin importe registrado. Se excluyen de los totales financieros.</p>}
      <dl className="access-metrics finance-metrics"><div><dt>Total bruto</dt><dd>{crc(data.totals.gross_crc)}</dd></div><div><dt>Concierto</dt><dd>{crc(data.totals.admission_crc)}</dd></div><div><dt>Transporte</dt><dd>{crc(data.totals.transport_crc)}</dd></div><div><dt>Entradas vendidas</dt><dd>{data.totals.sold}</dd></div></dl>
      <dl className="finance-counts"><div><dt>Compras con transporte</dt><dd>{data.totals.transport_count}</dd></div><div><dt>Accesos gratuitos emitidos</dt><dd>{data.totals.free}</dd></div><div><dt>Entradas emitidas</dt><dd>{data.totals.issued}</dd></div><div><dt>Utilizadas</dt><dd>{data.totals.admitted}</dd></div><div><dt>Por ingresar</dt><dd>{data.totals.pending}</dd></div><div><dt>Anuladas</dt><dd>{data.totals.voided}</dd></div></dl>
      {!!data.totals.voided_paid && <p className="notice">{data.totals.voided_paid} entradas anuladas conservan un pago verificado. Anular el QR no registra una devolución.</p>}
      {!!(data.totals.unverified + data.totals.cancelled + data.totals.refunded) && <p className="notice">Fuera de los ingresos verificados: {data.totals.unverified} entradas con pago pendiente, {data.totals.cancelled} con pago cancelado y {data.totals.refunded} con pago marcado como reembolsado.</p>}
      {!data.totals.issued && <p role="status">No hay entradas con estos filtros.</p>}
      <div className="finance-columns"><section aria-label="Ingresos del concierto por tipo"><h3>Concierto por tipo</h3>{chart.length ? <ul className="finance-chart">{chart.map((row, i) => <li key={i}><div><span>{row.name}</span><strong>{crc(row.amount)}</strong></div><progress max={chartMax} value={row.amount} aria-label={`Ingresos de ${row.name}`}/></li>)}</ul> : <p>No hay ventas de entradas con importe verificado.</p>}</section><section aria-label="Ingresos por origen"><h3>Por origen</h3>{data.sources.length ? <div className="ticket-table"><table><thead><tr><SortHeader column="source" sort={sourceSort.sort} onSort={sourceSort.toggle}>Origen</SortHeader><SortHeader column="admission" sort={sourceSort.sort} onSort={sourceSort.toggle}>Concierto</SortHeader><SortHeader column="transport" sort={sourceSort.sort} onSort={sourceSort.toggle}>Transporte</SortHeader><SortHeader column="gross" sort={sourceSort.sort} onSort={sourceSort.toggle}>Total bruto</SortHeader></tr></thead><tbody>{sourceSort.rows.map(source => <tr key={source.source}><td>{sources[source.source] || source.source}</td><td>{crc(source.admission_crc)}</td><td>{crc(source.transport_crc)}</td><td>{crc(source.gross_crc)}</td></tr>)}</tbody></table></div> : <p>Sin importes registrados.</p>}</section></div>
      <h3>Detalle por tipo y concepto</h3>{data.breakdown.length ? <div className="ticket-table"><table><thead><tr><SortHeader column="type" sort={detailSort.sort} onSort={detailSort.toggle}>Tipo</SortHeader><SortHeader column="kind" sort={detailSort.sort} onSort={detailSort.toggle}>Concepto</SortHeader><SortHeader column="source" sort={detailSort.sort} onSort={detailSort.toggle}>Origen</SortHeader><SortHeader column="payment" sort={detailSort.sort} onSort={detailSort.toggle}>Pago</SortHeader><SortHeader column="quantity" sort={detailSort.sort} onSort={detailSort.toggle}>Cantidad</SortHeader><SortHeader column="price" sort={detailSort.sort} onSort={detailSort.toggle}>Precio unitario</SortHeader><SortHeader column="gross" sort={detailSort.sort} onSort={detailSort.toggle}>Ingreso bruto verificado</SortHeader></tr></thead><tbody>{detailSort.rows.map((row, i) => <tr key={i}><td>{row.type_name}</td><td>{concepts[row.kind] || row.kind}</td><td>{sources[row.source] || row.source}</td><td>{paymentStates[row.payment_status] || row.payment_status}</td><td>{row.quantity}</td><td>{crc(row.unit_price_crc)}</td><td>{crc(row.gross_crc)}</td></tr>)}</tbody></table></div> : <p>Sin detalle financiero para estos filtros.</p>}
      {!!data.payment_methods?.length && <section aria-label="Ingresos por medio de pago"><h3>Por medio de pago</h3><div className="ticket-table"><table><thead><tr><SortHeader column="method" sort={paymentSort.sort} onSort={paymentSort.toggle}>Medio</SortHeader><SortHeader column="gross" sort={paymentSort.sort} onSort={paymentSort.toggle}>Total bruto verificado</SortHeader></tr></thead><tbody>{paymentSort.rows.map(method => <tr key={method.method}><td>{paymentMethods[method.method] || method.method}</td><td>{crc(method.gross_crc)}</td></tr>)}</tbody></table></div></section>}
      <small>Las tarifas históricas se conservan. Los importes netos, comisiones y devoluciones parciales no registradas no se calculan.</small>
    </>}
  </section>;
}
