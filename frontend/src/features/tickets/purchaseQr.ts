export type PurchaseQr = { token: string; qr: string };
export async function preparePurchaseQr(quantity: number): Promise<{ entries: PurchaseQr[]; url: string | null }> {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw new Error('Invalid quantity');
  const { default: QRCode } = await import('qrcode');
  const entries: PurchaseQr[] = [];
  for (let i = 0; i < quantity; i++) {
    const token = 'sra1_' + btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    entries.push({ token, qr: await QRCode.toDataURL(token, { width: 600, margin: 4, errorCorrectionLevel: 'M' }) });
  }
  if (quantity === 1) return { entries, url: null };
  const { zipSync, strToU8 } = await import('fflate');
  const files: Record<string, Uint8Array> = {};
  entries.forEach((entry, i) => { files[`entrada-${String(i + 1).padStart(3, '0')}.png`] = Uint8Array.from(atob(entry.qr.split(',')[1]), c => c.charCodeAt(0)); });
  files['LEAME.txt'] = strToU8('Cada PNG corresponde a una entrada independiente, válida para un solo ingreso. Entregue un archivo diferente a cada acompañante.');
  const zip = zipSync(files, { level: 0 });
  return { entries, url: URL.createObjectURL(new Blob([zip.slice().buffer as ArrayBuffer], { type: 'application/zip' })) };
}
