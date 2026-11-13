import { useEffect, useState, type FormEvent } from 'react';
import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from 'lucide-react';

export function useDebouncedSearch(query: string) {
  const [value, setValue] = useState(query.trim());
  useEffect(() => { const timer = setTimeout(() => setValue(query.trim()), 300); return () => clearTimeout(timer); }, [query]);
  return { query: value, pending: value !== query.trim() };
}

export function ListPagination({ page, pageSize, total, totalAll, noun, disabled, onPageChange, onPageSizeChange, extra }: {
  page: number; pageSize: number; total: number; totalAll: number; noun: 'entradas' | 'correos'; disabled: boolean;
  onPageChange: (page: number) => void; onPageSizeChange: (size: number) => void; extra?: string;
}) {
  const pages = Math.ceil(total / pageSize);
  const [target, setTarget] = useState(String(page + 1));
  useEffect(() => setTarget(String(page + 1)), [page]);
  const first = total ? page * pageSize + 1 : 0;
  const last = Math.min((page + 1) * pageSize, total);
  const visible = Array.from(new Set([0, ...Array.from({ length: 5 }, (_, i) => page - 2 + i), pages - 1])).filter(n => n >= 0 && n < pages).sort((a, b) => a - b);
  function jump(e: FormEvent) {
    e.preventDefault();
    const value = Number(target);
    if (!disabled && Number.isInteger(value) && value >= 1 && value <= pages) onPageChange(value - 1);
  }
  return <nav className="list-pagination" aria-label={`Paginación de ${noun}`}>
    <p className="list-count" role="status" aria-live="polite">{first}–{last} de <strong>{total} {total === 1 ? noun === 'entradas' ? 'entrada' : 'correo' : noun}</strong>{totalAll !== total && ` · ${totalAll} en total`}{extra && ` · ${extra}`}</p>
    <div className="pagination-options"><label>Por página<select aria-label="Por página" value={pageSize} disabled={disabled} onChange={e => onPageSizeChange(Number(e.target.value))}>{[20, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}</select></label><span>Página {total ? page + 1 : 0} de {pages}</span></div>
    <div className="pagination-pages">
      <button className="btn quiet" aria-label="Primera página" title="Primera página" disabled={disabled || page === 0 || !pages} onClick={() => onPageChange(0)}><ChevronsLeft size={18}/></button>
      <button className="btn quiet" disabled={disabled || page === 0 || !pages} onClick={() => onPageChange(page - 1)}><ChevronLeft size={16}/>Anterior</button>
      {visible.map((n, i) => <span key={n} className="pagination-number">{i > 0 && n > visible[i - 1] + 1 && <span className="pagination-gap" aria-hidden="true">…</span>}<button className="btn quiet" aria-label={`Página ${n + 1}`} aria-current={page === n ? 'page' : undefined} disabled={disabled} onClick={() => onPageChange(n)}>{n + 1}</button></span>)}
      <button className="btn quiet" disabled={disabled || !pages || page >= pages - 1} onClick={() => onPageChange(page + 1)}>Siguiente<ChevronRight size={16}/></button>
      <button className="btn quiet" aria-label="Última página" title="Última página" disabled={disabled || !pages || page >= pages - 1} onClick={() => onPageChange(pages - 1)}><ChevronsRight size={18}/></button>
    </div>
    {pages > 1 && <form className="pagination-jump" onSubmit={jump}><label>Ir a página<input aria-label="Ir a página" type="number" inputMode="numeric" min={1} max={pages} step={1} value={target} onChange={e => setTarget(e.target.value)} disabled={disabled} required/></label><button className="btn quiet" disabled={disabled}>Ir</button></form>}
  </nav>;
}
