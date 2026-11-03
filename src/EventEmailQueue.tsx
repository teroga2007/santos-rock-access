import { useEffect, useState } from 'react';
import { supabase } from './client';
type Job = { id: string; ticket_id: string; recipient: string; status: string; attempts: number; created_at: string; last_error: string | null };
const labels: Record<string, string> = { pending: 'Pendiente', processing: 'Procesando', submitted: 'Aceptado por Brevo', failed: 'Rechazado / error', unknown: 'Requiere revisión', cancelled: 'Cancelado' };
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
    Promise.resolve(supabase.from('ticket_email_jobs').select('id,ticket_id,recipient,status,attempts,created_at,last_error').eq('event_id', eventId).order('created_at', { ascending: false }).order('id').range(page * 20, page * 20 + 19)).then(({ data, error }) => {
      if (!active) return;
      if (error) setError('La cola todavía no está disponible o no se pudo consultar.');
      setJobs(data || []); setBusy(false);
    }).catch(() => { if (active) { setError('No se pudo consultar la cola. Vuelva a intentar.'); setBusy(false); } });
    return () => { active = false; };
  }, [eventId, revision, page]);
  async function retry(id: string) {
    if (!supabase || busy) return;
    setBusy(true); setError('');
    try { const { error } = await supabase.rpc('retry_ticket_email', { p_job_id: id }); if (error) setError('No se pudo reprogramar. Solo se reintentan mensajes rechazados, no envíos inciertos.'); else setRevision(v => v + 1); }
    catch { setError('No se pudo confirmar el reintento. Actualice la cola.'); }
    finally { setBusy(false); }
  }
  return <section className="mail-queue"><h3>Correos</h3><p>La aceptación del proveedor no confirma la entrega. Los envíos inciertos requieren revisión en Brevo.</p><button className="btn quiet" disabled={busy} onClick={() => setRevision(v => v + 1)}>Actualizar cola</button>{error && <p className="notice" role="alert">{error}</p>}{busy && <p role="status">Consultando…</p>}{jobs.length ? <div className="ticket-table"><table><thead><tr><th>Destinatario</th><th>Estado</th><th>Intentos</th><th>Acción</th></tr></thead><tbody>{jobs.map(job => <tr key={job.id}><td>{job.recipient}<small>{job.ticket_id}</small></td><td>{labels[job.status] || job.status}{job.last_error && <small>{job.status === 'unknown' ? 'Confirme el resultado en Brevo antes de reenviar.' : 'Revise el destinatario o contacte al administrador.'}</small>}</td><td>{job.attempts}</td><td>{job.status === 'failed' && <button className="btn quiet" disabled={busy} onClick={() => retry(job.id)}>Reintentar</button>}</td></tr>)}</tbody></table></div> : !busy && <p>No hay correos para mostrar.</p>}<div className="ticket-pagination"><button className="btn quiet" disabled={busy || page === 0} onClick={() => setPage(v => v - 1)}>Anterior</button><span>Página {page + 1}</span><button className="btn quiet" disabled={busy || jobs.length < 20} onClick={() => setPage(v => v + 1)}>Siguiente</button></div></section>;
}
