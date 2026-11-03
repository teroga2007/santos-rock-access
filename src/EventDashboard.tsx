import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { supabase } from './client';

type Totals = { total: number; admitted: number; pending: number; voided: number };
type Dashboard = {
  generated_at: string; event_status: string; totals: Totals;
  sources: (Totals & { source: string })[];
  types: (Totals & { id: string; name: string; access_zone: string; capacity: number | null })[];
  recent: { request_id: string; created_at: string; result: string; reason: string | null; type_name: string | null; access_zone: string | null }[];
};
const sourceLabels: Record<string, string> = { complimentary: 'Cortesías / acreditaciones', sinpe: 'SINPE', door: 'Puerta', other: 'Otro', ticketera: 'Ticketera' };
const resultLabels: Record<string, string> = { accepted: 'Ingreso autorizado', duplicate: 'Entrada ya utilizada', invalid: 'Código no válido', void: 'Entrada anulada', wrong_event: 'Otro evento', error: 'Ingreso deshabilitado' };
const statusLabels: Record<string, string> = { draft: 'Borrador', published: 'Publicado', live: 'En vivo', closed: 'Cerrado', cancelled: 'Cancelado' };
const time = (value: string) => new Intl.DateTimeFormat('es-CR', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'America/Costa_Rica' }).format(new Date(value));

export function EventDashboard({ eventId, userId, refreshKey }: { eventId: string; userId: string; refreshKey: string }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);
  const [revision, setRevision] = useState(0);
  const reload = useRef<() => void>(() => {});

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let active = true;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let forbidden = false;
    setData(null); setError(''); setDenied(false);
    async function load() {
      if (!active || inFlight || forbidden || document.hidden) return;
      clearTimeout(timer); inFlight = true; setBusy(true);
      controller = new AbortController();
      try {
        const result = await client.rpc('get_event_dashboard', { p_event_id: eventId }).abortSignal(controller.signal);
        if (!active) return;
        if (result.error?.code === '42501') { forbidden = true; setDenied(true); setData(null); setError(''); return; }
        if (result.error) { setError(result.error.code === 'PGRST202' ? 'Falta habilitar el panel de control en la base de datos.' : 'No se pudo actualizar el panel. Los datos anteriores pueden estar desactualizados.'); return; }
        if (!result.data?.totals || !Array.isArray(result.data.recent)) { setError('El servidor devolvió un resumen incompleto.'); return; }
        setData(result.data as Dashboard); setError('');
      } catch { if (active) setError('Sin conexión para actualizar el panel. Los datos anteriores pueden estar desactualizados.'); }
      finally {
        inFlight = false;
        if (active) { setBusy(false); if (!forbidden && !document.hidden) timer = setTimeout(load, 15000); }
      }
    }
    reload.current = () => { void load(); };
    function visibility() { if (document.hidden) clearTimeout(timer); else void load(); }
    document.addEventListener('visibilitychange', visibility);
    void load();
    return () => { active = false; clearTimeout(timer); controller?.abort(); document.removeEventListener('visibilitychange', visibility); };
  }, [eventId, userId, revision]);

  useEffect(() => { reload.current(); }, [refreshKey]);

  if (denied) return null;
  const admitted = data?.totals.admitted || 0;
  const activeTickets = admitted + (data?.totals.pending || 0);
  const percentage = activeTickets ? Math.round(admitted * 100 / activeTickets) : 0;
  return <section className="details-panel event-dashboard" aria-label="Panel de control del evento">
    <div className="form-heading"><h2>Panel de control</h2><button className="quiet" disabled={busy} onClick={() => reload.current()}><RefreshCw size={16}/>{busy ? 'Actualizando…' : 'Actualizar'}</button></div>
    <p>Actualización cada 15 segundos mientras esta pestaña esté visible.</p>
    {error && <div className="notice" role="alert">{error}<button className="quiet" disabled={busy} onClick={() => setRevision(v => v + 1)}>Reintentar</button></div>}
    {!data ? <p role="status">{busy ? 'Cargando resumen…' : 'Resumen no disponible.'}</p> : <>
      <p className="dashboard-updated">Última consulta: {time(data.generated_at)} · {statusLabels[data.event_status] || data.event_status}</p>
      <dl className="access-metrics"><div><dt>Entradas emitidas</dt><dd>{data.totals.total}</dd></div><div><dt>Ingresos</dt><dd>{admitted}</dd></div><div><dt>Pendientes</dt><dd>{data.totals.pending}</dd></div><div><dt>Anuladas</dt><dd>{data.totals.voided}</dd></div></dl>
      <div className="access-progress"><label htmlFor="event-admission-progress">Ingresó el {percentage}% de las entradas vigentes</label><progress id="event-admission-progress" max={activeTickets || 1} value={admitted}/><small>Las entradas vigentes excluyen las anuladas. Este porcentaje no representa el aforo del recinto.</small></div>
      <h3>Por origen</h3>{data.sources.length ? <div className="ticket-table"><table><thead><tr><th>Origen</th><th>Emitidas</th><th>Ingresos</th><th>Pendientes</th><th>Anuladas</th></tr></thead><tbody>{data.sources.map(source => <tr key={source.source}><td>{sourceLabels[source.source] || source.source}</td><td>{source.total}</td><td>{source.admitted}</td><td>{source.pending}</td><td>{source.voided}</td></tr>)}</tbody></table></div> : <p>Todavía no se emitieron entradas.</p>}
      <h3>Por tipo y zona</h3>{data.types.length ? <div className="ticket-table"><table><thead><tr><th>Tipo / zona</th><th>Ingresos</th><th>Pendientes</th><th>Cupo disponible</th></tr></thead><tbody>{data.types.map(type => <tr key={type.id}><td>{type.name}<small>{type.access_zone}</small></td><td>{type.admitted}</td><td>{type.pending}</td><td>{type.capacity === null ? 'Sin límite' : Math.max(0, type.capacity - type.admitted - type.pending)}</td></tr>)}</tbody></table></div> : <p>Todavía no hay tipos de entrada.</p>}
      <h3>Últimas 15 lecturas</h3><p>Los reintentos de una misma solicitud se muestran una sola vez. Los códigos rechazados por formato en el dispositivo no llegan al servidor.</p>{data.recent.length ? <div className="ticket-table"><table><thead><tr><th>Hora (Costa Rica)</th><th>Resultado</th><th>Tipo / zona</th></tr></thead><tbody>{data.recent.map(scan => <tr key={scan.request_id}><td>{time(scan.created_at)}</td><td><span className={`scan-label ${scan.result === 'accepted' ? 'scan-label-accepted' : ''}`}>{resultLabels[scan.result] || scan.result}</span></td><td>{scan.type_name ? `${scan.type_name} · ${scan.access_zone}` : '—'}</td></tr>)}</tbody></table></div> : <p>Todavía no hay lecturas registradas.</p>}
    </>}
  </section>;
}
