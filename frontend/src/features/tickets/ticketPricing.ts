export type TicketPrice = { price_crc: number | string | null; transport_price_crc: number | string; category: string };
export type PricedTicketType = Partial<TicketPrice> & { id: string; name: string; capacity?: number | null; access_zone?: string };
export const crc = (amount: number) => new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 2 }).format(amount);
export function pricing(type?: Partial<TicketPrice>) {
  const known = type?.price_crc != null;
  const admission = known ? Number(type.price_crc) : 0;
  const transport = known ? Number(type.transport_price_crc || 0) : 0;
  return { known, admission, transport, total: admission + transport, paid: admission + transport > 0 };
}
