import { mailTiming, useMailAvailability } from './mailAvailability';
import { SortHeader, type SortState } from '../../components/tableSort';
import { ListPagination, useDebouncedSearch } from '../../components/ListPagination';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

type Job = { id: string; ticket_count: number; cancelled_count: number; recipient: string; status: string; attempts: number; created_at: string; last_error: string | null };
const labels: Record<string, string> = { pending: 'Pendiente', processing: 'Procesando', submitted: 'Aceptado por Brevo', failed: 'Rechazado / error', unknown: 'Requiere revisión', cancelled: 'Cancelado' };
export function EventEmailQueue({ eventId }: { eventId: string }) {
  const availability = useMailAvailability();
  useEffect(() => { const timer = setInterval(() => { if (!document.hidden) setRevision(value => value + 1); }, 30000); return () => clearInterval(timer); }, []);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState<number | null>(null);
  const [totalAll, setTotalAll] = useState(0);
  const [ticketTotal, setTicketTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const searchState = useDebouncedSearch(search);
  const loading = busy || searchState.pending;
  const [tableSort, setTableSort] = useState<SortState>({ key: 'created_at', direction: 'desc' });
  function sortEmails(key: string) { setTableSort(current => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' })); setPage(0); }
  function clearFilters() { setSearch(''); setStatusFilter(''); setPage(0); }
  useEffect(() => {
    if (!supabase || searchState.pending) return;
    let active = true;
    setBusy(true); setError('');
    Promise.resolve(supabase.rpc('search_event_email_deliveries', { p_event_id: eventId, p_query: searchState.query, p_status: statusFilter || null, p_limit: pageSize, p_offset: page * pageSize, p_sort_by: tableSort.key, p_ascending: tableSort.direction === 'asc' })).then(({ data, error }) => {
      if (!active) return;
      if (error || !Array.isArray(data?.items) || !Number.isSafeInteger(data?.total)) { setError('No se pudo consultar la cola. Actualice para reintentar.'); setJobs([]); setTotal(null); setBusy(false); return; }
      const lastPage = Math.max(0, Math.ceil(data.total / pageSize) - 1);
      if (page > lastPage) { setPage(lastPage); return; }
      setJobs(data.items); setTotal(data.total); setTotalAll(data.total_all); setTicketTotal(data.ticket_total); setBusy(false);
    }).catch(() => { if (active) { setError('No se pudo consultar la cola. Vuelva a intentar.'); setJobs([]); setTotal(null); setBusy(false); } });
    return () => { active = false; };
  }, [eventId, revision, page, pageSize, tableSort, searchState.query, searchState.pending, statusFilter]);
  async function retry(id: string) {
    if (!supabase || loading) return;
    setBusy(true); setError('');
    try { const { error } = await supabase.rpc('retry_ticket_email_delivery', { p_delivery_id: id }); if (error) setError('No se pudo reprogramar. Solo se reintentan mensajes rechazados, no envíos inciertos.'); else setRevision(v => v + 1); }
    catch { setError('No se pudo confirmar el reintento. Actualice la cola.'); }
    finally { setBusy(false); }
  }
  return <section className="mail-queue"><h3>Correos</h3>
    {!availability.checking && availability.ready && <p className={availability.enabled ? 'created-message' : 'notice'} role="status">{availability.enabled ? mailTiming : 'Envíos pausados. Los correos pendientes se procesarán al activar el servicio.'}</p>}
    <p>La aceptación del proveedor no confirma la entrega. Los envíos inciertos requieren revisión en Brevo.</p>
    <div className="list-filters">
      <label>Buscar correos<input type="search" maxLength={160} value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder="Correo, nombre del titular, tipo o ID"/></label>
      <label>Estado del correo<select aria-label="Estado del correo" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(0); }}><option value="">Todos los estados</option>{Object.entries(labels).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      {(search || statusFilter) && <button className="btn quiet" onClick={clearFilters}>Limpiar filtros</button>}
      <button className="btn quiet" disabled={loading} onClick={() => setRevision(v => v + 1)}>Actualizar cola</button>
    </div>
    {error && <p className="notice" role="alert">{error}</p>}{loading && <p role="status">{searchState.pending ? 'Buscando correos…' : 'Consultando…'}</p>}
    {jobs.length ? <div className="ticket-table"><table aria-busy={loading}><thead><tr><SortHeader column="recipient" sort={tableSort} onSort={sortEmails} disabled={loading}>Destinatario</SortHeader><SortHeader column="status" sort={tableSort} onSort={sortEmails} disabled={loading}>Estado</SortHeader><SortHeader column="attempts" sort={tableSort} onSort={sortEmails} disabled={loading}>Intentos</SortHeader><th>Acción</th></tr></thead><tbody>{jobs.map(job => <tr key={job.id}><td>{job.recipient}<small>{job.ticket_count} entradas{job.cancelled_count > 0 ? ` · ${job.cancelled_count} canceladas` : ''}</small></td><td><span className={'mail-status mail-status-' + job.status}>{labels[job.status] || job.status}</span>{job.last_error && <small>{job.status === 'unknown' ? 'Confirme el resultado en Brevo antes de reenviar.' : 'Revise el destinatario o contacte al administrador.'}</small>}</td><td>{job.attempts}</td><td>{job.status === 'failed' && <button className="btn quiet" disabled={loading} onClick={() => retry(job.id)}>Reintentar</button>}</td></tr>)}</tbody></table></div> : !loading && !error && <div className="list-empty"><p>{search || statusFilter ? 'No hay correos que coincidan con la búsqueda.' : 'No hay correos para mostrar.'}</p>{(search || statusFilter) && <button className="btn quiet" onClick={clearFilters}>Limpiar búsqueda</button>}</div>}
    {total !== null && !error && <ListPagination page={page} pageSize={pageSize} total={total} totalAll={totalAll} noun="correos" extra={`${ticketTotal} ${ticketTotal === 1 ? 'entrada asociada' : 'entradas asociadas'}`} disabled={loading} onPageChange={setPage} onPageSizeChange={size => { setPageSize(size); setPage(0); }}/>}</section>;
}
