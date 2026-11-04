import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

export type SortState = { key: string; direction: 'asc' | 'desc' };
type Value = string | number | null | undefined;
const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
export function useTableSort<T>(items: T[], columns: Record<string, (item: T) => Value>, initial?: SortState) {
  const [sort, setSort] = useState<SortState | undefined>(initial);
  const rows = useMemo(() => {
    if (!sort || !columns[sort.key]) return items;
    const value = columns[sort.key];
    return items.map((item, index) => ({ item, index })).sort((a, b) => {
      const x = value(a.item), y = value(b.item);
      if (x == null && y == null) return a.index - b.index;
      if (x == null) return 1;
      if (y == null) return -1;
      const compared = typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y));
      return compared * (sort.direction === 'asc' ? 1 : -1) || a.index - b.index;
    }).map(row => row.item);
  }, [items, columns, sort]);
  function toggle(key: string) { setSort(current => ({ key, direction: current?.key === key && current.direction === 'asc' ? 'desc' : 'asc' })); }
  return { rows, sort, toggle };
}
export function SortHeader({ children, column, sort, onSort, disabled = false }: {
  children: ReactNode; column: string; sort?: SortState; onSort: (column: string) => void; disabled?: boolean;
}) {
  const selected = sort?.key === column;
  const Icon = selected ? sort.direction === 'asc' ? ArrowUp : ArrowDown : ArrowUpDown;
  return <th scope="col" aria-sort={selected ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}><button className="sort-header" type="button" disabled={disabled} onClick={() => onSort(column)}>{children}<Icon size={14} aria-hidden="true"/></button></th>;
}
