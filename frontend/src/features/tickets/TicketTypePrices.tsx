import { Pencil, Trash2 } from 'lucide-react';
import { SortHeader, useTableSort } from '../../components/tableSort';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { crc, pricing, type PricedTicketType } from './ticketPricing';

export function TicketTypePrices({ eventId, types, disabled, onChanged, onPendingChange }: {
  eventId: string; types: PricedTicketType[]; disabled: boolean;
  onChanged: () => void; onPendingChange: (pending: boolean) => void;
}) {
  const [editing, setEditing] = useState<PricedTicketType | null>(null);
  const [removing, setRemoving] = useState<PricedTicketType | null>(null);
  const deleteHeading = useRef<HTMLHeadingElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const typeSort = useTableSort(types, { name: t => t.name, price: t => pricing(t).known ? pricing(t).admission : null, transport: t => pricing(t).known ? pricing(t).transport : null, total: t => pricing(t).known ? pricing(t).total : null });
  useEffect(() => { onPendingChange(busy || !!removing); return () => onPendingChange(false); }, [busy, removing, onPendingChange]);
  useEffect(() => { if (removing) { deleteHeading.current?.focus(); deleteHeading.current?.scrollIntoView({ block: 'center' }); } }, [removing]);
  async function remove() {
    if (!supabase || busy || disabled || !removing) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const { data, error } = await supabase.rpc('delete_ticket_type', { p_event_id: eventId, p_type_id: removing.id, p_type_name: removing.name });
      if (error) {
        setError(error.code === '23503' ? 'No se puede eliminar este tipo: ya tiene entradas o importaciones registradas, incluso si las entradas fueron anuladas.' : error.code === '22023' ? 'El nombre cambió. Actualice los tipos antes de eliminarlo.' : failure(error.code));
        return;
      }
      if (data !== removing.id) { setError('No se pudo confirmar la eliminación. Actualice los tipos antes de reintentar.'); return; }
      if (editing?.id === removing.id) setEditing(null);
      setRemoving(null); setMessage('Tipo de entrada eliminado.'); onChanged();
    } catch { setError('No se pudo confirmar la eliminación. Actualice los tipos antes de reintentar.'); }
    finally { setBusy(false); }
  }
  function failure(code?: string) {
    return code === '23505' ? 'Ya existe un tipo con ese nombre.' : code === '42501' ? 'Su cuenta no tiene permiso para modificar tarifas.' : code === '22023' ? 'Revise los precios. Las acreditaciones deben tener ambos importes en cero.' : code === '23514' ? 'El evento está cerrado o el cupo es menor que las entradas vigentes.' : 'No se pudo confirmar el cambio. Actualice los tipos antes de reintentar.';
  }
  async function defaults() {
    if (!supabase || busy || disabled) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const { data, error } = await supabase.rpc('configure_event_ticket_prices', { p_event_id: eventId });
      if (error) { setError(failure(error.code)); return; }
      setMessage(data ? `${data} tipos agregados. Las tarifas existentes se conservaron.` : 'Los tipos sugeridos ya existen.'); onChanged();
    } catch { setError(failure()); }
    finally { setBusy(false); }
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!supabase || busy || disabled) return;
    const form = e.currentTarget; const values = new FormData(form);
    setBusy(true); setError(''); setMessage('');
    try {
      const { error } = await supabase.rpc('save_ticket_type_prices', {
        p_event_id: eventId, p_type_id: editing?.id || null, p_name: String(values.get('name')).trim(),
        p_price_crc: Number(values.get('price')), p_transport_price_crc: Number(values.get('transport')),
        p_category: String(values.get('category')), p_capacity: values.get('capacity') ? Number(values.get('capacity')) : null,
        p_access_zone: String(values.get('zone')).trim(),
      });
      if (error) { setError(failure(error.code)); return; }
      setEditing(null); form.reset(); setMessage('Tarifa guardada. Las ventas anteriores conservan su importe.'); onChanged();
    } catch { setError(failure()); }
    finally { setBusy(false); }
  }
  return <section aria-label="Tipos y precios"><div className="form-heading"><h3>Tipos y precios</h3><button className="btn quiet" disabled={busy || disabled || !!removing} onClick={defaults}>Agregar tarifas Santos Rock</button></div>
    {error && <p className="notice" role="alert">{error}</p>}{message && <p className="created-message" role="status">{message}</p>}
    {!!types.length && <div className="ticket-table"><table><thead><tr><SortHeader column="name" sort={typeSort.sort} onSort={typeSort.toggle}>Tipo</SortHeader><SortHeader column="price" sort={typeSort.sort} onSort={typeSort.toggle}>Concierto</SortHeader><SortHeader column="transport" sort={typeSort.sort} onSort={typeSort.toggle}>Transporte</SortHeader><SortHeader column="total" sort={typeSort.sort} onSort={typeSort.toggle}>Total</SortHeader><th>Acciones</th></tr></thead><tbody>{typeSort.rows.map(type => { const price = pricing(type); return <tr key={type.id}><td>{type.name}</td><td>{price.known ? crc(price.admission) : 'Sin precio'}</td><td>{price.known ? crc(price.transport) : '—'}</td><td>{price.known ? crc(price.total) : '—'}</td><td><div className="ticket-row-actions"><button className="btn quiet" aria-label={`Editar ${type.name}`} disabled={busy || disabled || !!removing} onClick={() => { setEditing(type); setError(''); setMessage(''); }}><Pencil size={16} aria-hidden="true"/>Editar</button><button className="btn quiet danger-button" aria-label={`Eliminar ${type.name}`} disabled={busy || disabled || !!removing} onClick={() => { setRemoving(type); setError(''); setMessage(''); }}><Trash2 size={16} aria-hidden="true"/>Eliminar</button></div></td></tr>; })}</tbody></table></div>}
    {removing && <section className="notice" role="alertdialog" aria-modal="false" aria-labelledby="delete-type-heading"><h4 id="delete-type-heading" ref={deleteHeading} tabIndex={-1}>Eliminar {removing.name}</h4><p>Solo se puede eliminar si no tiene entradas ni importaciones registradas. Esta acción no se puede deshacer.</p><div className="scanner-actions"><button className="btn quiet danger-button" disabled={busy || disabled} onClick={remove}>{busy ? 'Eliminando…' : 'Confirmar eliminación'}</button><button className="btn quiet" disabled={busy} onClick={() => { setRemoving(null); setError(''); }}>Cancelar</button></div></section>}
    <form key={editing?.id || 'new'} onSubmit={save}><h3>{editing ? `Editar: ${editing.name}` : 'Nuevo tipo de entrada'}</h3><fieldset disabled={busy || disabled || !!removing}>
      <label>Nombre<input name="name" defaultValue={editing?.name || ''} required minLength={2} maxLength={100}/></label>
      <label>Concepto<select name="category" defaultValue={editing?.category || 'admission'}><option value="admission">Entrada al concierto</option><option value="accreditation">Acreditación gratuita</option></select></label>
      <div className="form-dates"><label>Precio del concierto (CRC)<input name="price" type="number" min={0} max={9999999999.99} step="0.01" defaultValue={editing?.price_crc ?? ''} required/></label><label>Transporte incluido (CRC)<input name="transport" type="number" min={0} max={9999999999.99} step="0.01" defaultValue={editing?.transport_price_crc ?? 0} required/></label></div>
      <small>Para una entrada con transporte, registre ambos importes. Se emite un solo QR.</small>
      <label>Cupo (opcional)<input name="capacity" type="number" min={0} max={2147483647} step={1} defaultValue={editing?.capacity ?? ''}/></label>
      <label>Zona de acceso<input name="zone" maxLength={80} required defaultValue={editing?.access_zone || 'general'}/></label>
      <div className="scanner-actions"><button className="btn primary">{busy ? 'Guardando…' : 'Guardar tarifa'}</button>{editing && <button className="btn quiet" type="button" onClick={() => setEditing(null)}>Cancelar edición</button>}</div>
    </fieldset></form>
  </section>;
}
