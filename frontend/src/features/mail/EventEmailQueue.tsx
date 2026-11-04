import { mailTiming, useMailAvailability } from './mailAvailability';
import { SortHeader, type SortState } from '../../components/tableSort';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
type Job = { id: string; ticket_id: string; recipient: string; status: string; attempts: number; created_at: string; last_error: string | null };
const labels: Record<string, string> = { pending: 'Pendiente', processing: 'Procesando', submitted: 'Aceptado por Brevo', failed: 'Rechazado / error', unknown: 'Requiere revisión', cancelled: 'Cancelado' };
export function EventEmailQueue({ eventId }: { eventId: string }) {
  const availability = useMailAvailability();
  useEffect(() => { const timer = setInterval(() => { if (!document.hidden) setRevision(value => value + 1); }, 30000); return () => clearInterval(timer); }, []);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(0);
  const [tableSort, setTableSort] = useState<SortState>({ key: 'created_at', direction: 'desc' });
  function sortEmails(key: string) { setTableSort(current => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' })); setPage(0); }
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    setBusy(true); setError('');
    Promise.resolve(supabase.rpc('list_event_ticket_emails_sorted', { p_event_id: eventId, p_limit: 20, p_offset: page * 20, p_sort_by: tableSort.key, p_ascending: tableSort.direction === 'asc' })).then(({ data, error }) => {
      if (!active) return;
      if (error) setError('La cola todavía no está disponible o no se pudo consultar.');
      setJobs(data || []); setBusy(false);
    }).catch(() => { if (active) { setError('No se pudo consultar la cola. Vuelva a intentar.'); setBusy(false); } });
    return () => { active = false; };
  }, [eventId, revision, page, tableSort]);
  async function retry(id: string) {
    if (!supabase || busy) return;
    setBusy(true); setError('');
    try { const { error } = await supabase.rpc('retry_ticket_email', { p_job_id: id }); if (error) setError('No se pudo reprogramar. Solo se reintentan mensajes rechazados, no envíos inciertos.'); else setRevision(v => v + 1); }
    catch { setError('No se pudo confirmar el reintento. Actualice la cola.'); }
    finally { setBusy(false); }
  }
  return <section className="mail-queue"><h3>Correos</h3>{!availability.checking && availability.ready && <p className={availability.enabled ? 'created-message' : 'notice'} role="status">{availability.enabled ? mailTiming : 'Envíos pausados. Los correos pendientes se procesarán al activar el servicio.'}</p>}<p>La aceptación del proveedor no confirma la entrega. Los envíos inciertos requieren revisión en Brevo.</p><button className="btn quiet" disabled={busy} onClick={() => setRevision(v => v + 1)}>Actualizar cola</button>{error && <p className="notice" role="alert">{error}</p>}{busy && <p role="status">Consultando…</p>}{jobs.length ? <div className="ticket-table"><table aria-busy={busy}><thead><tr><SortHeader column="recipient" sort={tableSort} onSort={sortEmails} disabled={busy}>Destinatario</SortHeader><SortHeader column="status" sort={tableSort} onSort={sortEmails} disabled={busy}>Estado</SortHeader><SortHeader column="attempts" sort={tableSort} onSort={sortEmails} disabled={busy}>Intentos</SortHeader><th>Acción</th></tr></thead><tbody>{jobs.map(job => <tr key={job.id}><td>{job.recipient}<small>{job.ticket_id}</small></td><td><span className={'mail-status mail-status-' + job.status}>{labels[job.status] || job.status}</span>{job.last_error && <small>{job.status === 'unknown' ? 'Confirme el resultado en Brevo antes de reenviar.' : 'Revise el destinatario o contacte al administrador.'}</small>}</td><td>{job.attempts}</td><td>{job.status === 'failed' && <button className="btn quiet" disabled={busy} onClick={() => retry(job.id)}>Reintentar</button>}</td></tr>)}</tbody></table></div> : !busy && <p>No hay correos para mostrar.</p>}<div className="ticket-pagination"><button className="btn quiet" disabled={busy || page === 0} onClick={() => setPage(v => v - 1)}>Anterior</button><span>Página {page + 1}</span><button className="btn quiet" disabled={busy || jobs.length < 20} onClick={() => setPage(v => v + 1)}>Siguiente</button></div></section>;
}
