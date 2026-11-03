import { useEffect, useState } from 'react';
import { supabase } from './client';
type Job = { id: string; ticket_id: string; recipient: string; status: string; attempts: number; created_at: string; last_error: string | null };
const labels: Record<string, string> = { pending: 'Pendiente', processing: 'Procesando', submitted: 'Aceptado por Brevo', failed: 'Rechazado / error', unknown: 'Revisar en Brevo', cancelled: 'Cancelado' };
export function EventEmailQueue({ eventId }: { eventId: string }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    setBusy(true); setError('');
    supabase.from('ticket_email_jobs').select('id,ticket_id,recipient,status,attempts,created_at,last_error').eq('event_id', eventId).order('created_at', { ascending: false }).order('id').range(page * 20, page * 20 + 19).then(({ data, error }) => {
      if (!active) return;
      if (error) setError('La cola todavía no está disponible o no se pudo consultar.');
      setJobs(data || []); setBusy(false);
    });
    return () => { active = false; };
  }, [eventId, revision, page]);
  async function retry(id: string) {
    if (!supabase || busy) return;
    setBusy(true); setError('');
    try { const { error } = await supabase.rpc('retry_ticket_email', { p_job_id: id }); if (error) setError('No se pudo reprogramar. Solo se reintentan mensajes rechazados, no envíos inciertos.'); else setRevision(v => v + 1); }
    catch { setError('No se pudo confirmar el reintento. Actualizá la cola.'); }
    finally { setBusy(false); }
  }
  return <details className="type-setup"><summary>Cola de correos</summary><p>“Aceptado por Brevo” no confirma entrega en la bandeja. Revisá los resultados inciertos en Brevo antes de actuar; no se reenvían automáticamente.</p><button className="quiet" disabled={busy} onClick={() => setRevision(v => v + 1)}>Actualizar cola</button>{error && <p className="notice" role="alert">{error}</p>}{busy && <p role="status">Consultando…</p>}{jobs.length ? <div className="ticket-table"><table><thead><tr><th>Destinatario</th><th>Estado</th><th>Intentos</th><th>Acción</th></tr></thead><tbody>{jobs.map(job => <tr key={job.id}><td>{job.recipient}<small>{job.ticket_id}</small></td><td>{labels[job.status] || job.status}{job.last_error && <small>{job.last_error}</small>}</td><td>{job.attempts}</td><td>{job.status === 'failed' && <button className="quiet" disabled={busy} onClick={() => retry(job.id)}>Reintentar</button>}</td></tr>)}</tbody></table></div> : !busy && <p>No hay trabajos en esta página.</p>}<div className="ticket-pagination"><button className="quiet" disabled={busy || page === 0} onClick={() => setPage(v => v - 1)}>Anterior</button><span>Página {page + 1}</span><button className="quiet" disabled={busy || jobs.length < 20} onClick={() => setPage(v => v + 1)}>Siguiente</button></div></details>;
}
