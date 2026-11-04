import { test, expect, type Page } from '@playwright/test';

const eventId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const organizationId = '33333333-3333-4333-8333-333333333333';
const ticketId = '44444444-4444-4444-8444-444444444444';
const event = { id: eventId, organization_id: organizationId, name: 'Encuentro Santos Rock', venue: 'Los Santos', starts_at: '2027-01-16T22:00:00Z', ends_at: null, timezone: 'America/Costa_Rica', status: 'live' };

async function fixture(page: Page, role: string, options: { failPermissions?: boolean; uncertainIssue?: boolean; priced?: boolean; financeError?: boolean; emptyFinance?: boolean; deleteError?: boolean; door?: boolean; uncertainDoor?: boolean; staleDoor?: boolean; typeInUse?: boolean; manyTickets?: boolean; mailEnabled?: boolean; mailUnavailable?: boolean; mailFailureOnce?: boolean; mailStatus?: string; mailGate?: Promise<void> } = {}) {
  const writes: string[] = [];
  let redeemed = false;
  let deleted = false;
  let doorCalls = 0;
  let doorPrice = 16000;
  let typeDeleted = false;
  let mailPosts = 0;
  await page.route('https://**.supabase.co/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const respond = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path.endsWith('/events')) return respond(url.searchParams.get('id') ? deleted ? null : event : deleted ? [] : [event]);
    if (path.endsWith('/rpc/sell_door_ticket')) {
      doorCalls++; writes.push('door');
      if (options.uncertainDoor && doorCalls === 1) return respond({ code: '08006' }, 503);
      if (options.staleDoor && doorCalls === 1) { doorPrice = 17000; return respond({ code: 'P0001' }, 400); }
      const body = route.request().postDataJSON(); const total = body.p_expected_price_crc;
      return respond({ ticket_id: ticketId, order_id: '55555555-5555-4555-8555-555555555555', total_crc: total, cash_change_crc: body.p_payment_method === 'cash' ? body.p_cash_received_crc - total : null });
    }
    if (path.endsWith('/rpc/delete_test_event')) {
      if (options.deleteError) return respond({ code: '55000' }, 409);
      writes.push('delete'); deleted = true; return respond({ deleted: true });
    }
    if (path.endsWith('/organizations')) return respond(url.searchParams.get('id') ? { name: 'Santos Rock' } : [{ id: organizationId, name: 'Santos Rock' }]);
    if (path.endsWith('/organization_members')) {
      if (options.failPermissions) return respond({ code: '42501', message: 'Forbidden' }, 403);
      return respond([{ user_id: userId, organization_id: organizationId, role: role === 'owner' ? 'owner' : 'member' }]);
    }
    if (path.endsWith('/event_members')) return respond(role === 'owner' ? [] : [{ user_id: userId, role }]);
    if (path.endsWith('/ticket_types') && typeDeleted) return respond([]);
    if (path.endsWith('/ticket_types')) return respond(options.door ? [
      { id: 'door', name: 'Día del evento / puerta', capacity: 999, access_zone: 'general', price_crc: doorPrice, transport_price_crc: 0, category: 'admission' },
      { id: 'bundle', name: 'Fase 1 + transporte', price_crc: 10000, transport_price_crc: 7500, category: 'admission' },
      { id: 'staff', name: 'Staff', price_crc: 0, transport_price_crc: 0, category: 'accreditation' },
    ] : [{ id: 'general', name: options.priced ? 'Fase 1 + transporte' : 'General', capacity: 999, access_zone: 'general', ...(options.priced ? { price_crc: 10000, transport_price_crc: 7500, category: 'admission' } : {}) }]);
    if (path.endsWith('/rpc/save_ticket_type_prices')) { writes.push('price'); return respond('general'); }
    if (path.endsWith('/rpc/delete_ticket_type')) {
      if (options.typeInUse) return respond({ code: '23503' }, 409);
      writes.push('delete-type'); typeDeleted = true; return respond('general');
    }
    if (path.endsWith('/rpc/configure_event_ticket_prices')) { writes.push('defaults'); return respond(7); }
    if (path.endsWith('/rpc/get_event_finances')) {
      if (options.financeError) return respond({ code: '42501' }, 403);
      const filtered = route.request().postDataJSON()?.p_source === 'sinpe';
      return respond({
        generated_at: '2026-11-03T18:00:00Z', currency: 'CRC',
        totals: { gross_crc: options.emptyFinance ? 0 : filtered ? 17500 : 31000, admission_crc: options.emptyFinance ? 0 : filtered ? 10000 : 23500, transport_crc: options.emptyFinance ? 0 : 7500, sold: options.emptyFinance ? 0 : filtered ? 1 : 2, transport_count: options.emptyFinance ? 0 : 1, free: options.emptyFinance ? 0 : 1, without_amount: options.emptyFinance ? 0 : 2, issued: options.emptyFinance ? 0 : 5, admitted: 0, pending: options.emptyFinance ? 0 : 5, voided: 0, voided_paid: 0, unverified: 0, cancelled: 0, refunded: 0 },
        breakdown: options.emptyFinance ? [] : [
          { type_id: 'general', type_name: 'Fase 1 + transporte', kind: 'admission', source: 'sinpe', payment_status: 'verified', unit_price_crc: 10000, quantity: 1, gross_crc: 10000 },
          { type_id: 'general', type_name: 'Fase 1 + transporte', kind: 'transport', source: 'sinpe', payment_status: 'verified', unit_price_crc: 7500, quantity: 1, gross_crc: 7500 },
          ...filtered ? [] : [{ type_id: 'phase2', type_name: 'Fase 2', kind: 'admission', source: 'door', payment_status: 'verified', unit_price_crc: 13500, quantity: 1, gross_crc: 13500 }],
        ],
        sources: options.emptyFinance ? [] : [{ source: 'sinpe', sold: 1, admission_crc: 10000, transport_crc: 7500, gross_crc: 17500 }, ...filtered ? [] : [{ source: 'door', sold: 1, admission_crc: 13500, transport_crc: 0, gross_crc: 13500 }]],
        types: [{ id: 'general', name: 'Fase 1 + transporte' }, { id: 'phase2', name: 'Fase 2' }],
      });
    }
    if (path.endsWith('/ticket_email_jobs')) return respond([]);
    if (path.endsWith('/rpc/get_ticket_email_recipient')) return respond('titular@example.com');
    if (path.endsWith('/rpc/manage_ticket_credential')) { writes.push('reissue'); return respond(ticketId); }
    if (path.endsWith('/rpc/get_event_dashboard')) return respond({ generated_at: '2026-11-03T18:00:00Z', event_status: event.status, totals: { total: 10, admitted: 3, pending: 7, voided: 0 }, sources: [], types: [], recent: [] });
    if (path.endsWith('/rpc/list_event_tickets_sorted') && options.manyTickets) {
      const q = route.request().postDataJSON();
      const rows = Array.from({ length: 25 }, (_, i) => ({ id: '44444444-4444-4444-8444-' + String(i + 1).padStart(12, '0'), full_name: 'Persona ' + String(i + 1).padStart(2, '0'), type_name: 'General', source: 'complimentary', status: 'issued', issued_at: new Date(Date.UTC(2026, 10, 3, 18, i)).toISOString() }));
      rows.sort((a, b) => String(a[q.p_sort_by as keyof typeof a]).localeCompare(String(b[q.p_sort_by as keyof typeof b])) * (q.p_ascending ? 1 : -1));
      return respond(rows.slice(q.p_offset, q.p_offset + q.p_limit));
    }
    if (path.endsWith('/rpc/list_event_ticket_emails_sorted')) {
      const q = route.request().postDataJSON();
      const rows = options.manyTickets ? Array.from({ length: 25 }, (_, i) => ({ id: String(i), ticket_id: ticketId, recipient: 'persona' + String(i + 1).padStart(2, '0') + '@example.com', status: 'pending', attempts: i + 1, created_at: new Date(Date.UTC(2026, 10, 3, 18, i)).toISOString(), last_error: null })) : [];
      rows.sort((a, b) => (q.p_sort_by === 'attempts' ? a.attempts - b.attempts : String(a[q.p_sort_by as keyof typeof a]).localeCompare(String(b[q.p_sort_by as keyof typeof b]))) * (q.p_ascending ? 1 : -1));
      return respond(rows.slice(q.p_offset, q.p_offset + q.p_limit));
    }
    if (path.endsWith('/rpc/import_priced_native_tickets')) return respond([{ row: 1, ticket_id: ticketId }, { row: 2, ticket_id: '66666666-6666-4666-8666-666666666666' }]);
    if (path.endsWith('/rpc/list_event_tickets_sorted')) return respond([{ id: ticketId, full_name: 'Persona invitada', type_name: 'General', source: 'complimentary', status: 'issued', issued_at: '2026-11-03T18:00:00Z' }]);
    if (path.endsWith('/rpc/issue_priced_ticket')) {
      writes.push('issue');
      return options.uncertainIssue ? respond({ code: '08006' }, 503) : respond(ticketId);
    }
    if (path.endsWith('/rpc/redeem_ticket')) {
      writes.push('redeem'); const result = redeemed ? 'duplicate' : 'accepted'; redeemed = true;
      return respond({ result, type_name: 'General', access_zone: 'general' });
    }
    if (path.endsWith('/auth/v1/user')) return respond({ id: userId, email: 'equipo@example.com', aud: 'authenticated' });
    // Any unexpected request is blocked; these tests never access the real project.
    return respond({ code: 'UNEXPECTED_FIXTURE_REQUEST' }, 400);
  });
  await page.route('**/.netlify/functions/**', async route => {
    if (route.request().method() !== 'POST') return route.fulfill({ status: options.mailUnavailable ? 503 : 200, contentType: 'application/json', body: JSON.stringify({ configured: !options.mailUnavailable, sending_enabled: !!options.mailEnabled, daily_limit: 80 }) });
    mailPosts++; writes.push('mail');
    if (options.mailGate) await options.mailGate;
    if (options.mailFailureOnce && mailPosts === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'uncertain' }) });
    const body = route.request().postDataJSON();
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ jobs: body.items.map((item: { ticket_id: string }, i: number) => ({ id: 'job-' + i, ticket_id: item.ticket_id, status: options.mailStatus || 'pending' })), sending_enabled: !!options.mailEnabled, daily_limit: 80 }) });
  });
  await page.addInitScript(({ userId }) => {
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const payload = btoa(JSON.stringify({ sub: userId, exp: expires, role: 'authenticated' }));
    localStorage.setItem('sb-ui-check-auth-token', JSON.stringify({ access_token: 'eyJhbGciOiJIUzI1NiJ9.' + payload + '.fixture', refresh_token: 'fixture', token_type: 'bearer', expires_at: expires, expires_in: 3600, user: { id: userId, email: 'equipo@example.com', aud: 'authenticated' } }));
  }, { userId });
  return writes;
}

test('login uses the Santos Rock brand without setup copy', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
  await expect(page.getByAltText('Santos Rock')).toBeVisible();
  await expect(page.getByLabel('Correo electrónico')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('.env.local');
  expect(await page.locator('body').evaluate(el => getComputedStyle(el).fontFamily)).toContain('DM Sans');
  await page.screenshot({ path: 'test-results/access-login.png', fullPage: true, animations: 'disabled' });
});

test('owner sees task navigation and ticket drafts survive section changes', async ({ page }) => {
  await fixture(page, 'owner');
  await page.goto('/events/' + eventId);
  const nav = page.getByRole('navigation', { name: 'Secciones del evento' });
  await expect(nav.getByRole('button')).toHaveText(['Resumen', 'Ingreso', 'Venta en puerta', 'Entradas', 'Finanzas', 'Equipo']);
  await nav.getByRole('button', { name: 'Entradas', exact: true }).click();
  await page.getByRole('button', { name: 'Emitir entrada', exact: true }).click();
  await page.getByLabel('Nombre del titular').fill('Nombre conservado');
  await nav.getByRole('button', { name: 'Resumen' }).click();
  await nav.getByRole('button', { name: 'Entradas', exact: true }).click();
  await expect(page.getByLabel('Nombre del titular')).toHaveValue('Nombre conservado');
  await nav.getByRole('button', { name: 'Resumen' }).click();
  await expect(page.getByRole('heading', { name: 'Resumen de accesos' })).toBeVisible();
  expect(await page.locator('.skip-link').evaluate(el => el.matches(':focus'))).toBe(false);
  await page.screenshot({ path: 'test-results/access-desktop.png', fullPage: true, animations: 'disabled' });
});

test('supervisor can consult tickets without issuance or team administration', async ({ page }) => {
  await fixture(page, 'supervisor');
  await page.goto('/events/' + eventId);
  const nav = page.getByRole('navigation', { name: 'Secciones del evento' });
  await expect(nav.getByRole('button')).toHaveText(['Resumen', 'Ingreso', 'Entradas', 'Finanzas']);
  await nav.getByRole('button', { name: 'Entradas', exact: true }).click();
  await expect(page.getByRole('cell', { name: /^Persona invitada/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Emitir entrada', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Anular', exact: true })).toHaveCount(0);
});

test('door staff opens the scanner and distinguishes accepted and duplicate', async ({ page }) => {
  const writes = await fixture(page, 'scanner');
  await page.goto('/events/' + eventId);
  const nav = page.getByRole('navigation', { name: 'Secciones del evento' });
  await expect(nav.getByRole('button')).toHaveText(['Resumen', 'Ingreso']);
  await expect(nav.getByRole('button', { name: 'Ingreso' })).toHaveAttribute('aria-current', 'page');
  await page.getByText('Cargar imagen o ingresar código', { exact: true }).click();
  const token = 'sra1_' + 'a'.repeat(43);
  await page.getByLabel('Código de la entrada', { exact: true }).fill(token);
  await page.getByRole('button', { name: 'Registrar ingreso', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ingreso autorizado' })).toBeVisible();
  await page.getByRole('button', { name: 'Siguiente lectura' }).click();
  await page.getByLabel('Código de la entrada', { exact: true }).fill(token);
  await page.getByRole('button', { name: 'Registrar ingreso', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Entrada ya utilizada' })).toBeVisible();
  expect(writes).toEqual(['redeem', 'redeem']);
});

test('unsaved QR blocks navigation until explicitly saved', async ({ page }) => {
  const writes = await fixture(page, 'owner');
  await page.goto('/events/' + eventId);
  const nav = page.getByRole('navigation', { name: 'Secciones del evento' });
  await nav.getByRole('button', { name: 'Entradas', exact: true }).click();
  await page.getByRole('button', { name: 'Emitir entrada', exact: true }).click();
  await page.getByLabel('Nombre del titular').fill('Persona invitada');
  await page.getByRole('button', { name: 'Emitir entrada y generar QR' }).click();
  await expect(page.getByRole('heading', { name: 'Entrada emitida', exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Ingreso' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Emitir otra entrada' })).toBeDisabled();
  await page.getByLabel('Confirmo que guardé el QR').check();
  await expect(nav.getByRole('button', { name: 'Ingreso' })).toBeEnabled();
  expect(writes).toEqual(['issue']);
});

test('uncertain issuance preserves the request and blocks leaving', async ({ page }) => {
  await fixture(page, 'owner', { uncertainIssue: true });
  await page.goto('/events/' + eventId);
  const nav = page.getByRole('navigation', { name: 'Secciones del evento' });
  await nav.getByRole('button', { name: 'Entradas', exact: true }).click();
  await page.getByRole('button', { name: 'Emitir entrada', exact: true }).click();
  await page.getByLabel('Nombre del titular').fill('Persona invitada');
  await page.getByRole('button', { name: 'Emitir entrada y generar QR' }).click();
  await expect(page.getByRole('button', { name: 'Reintentar la misma emisión' })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Resumen' })).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Entrada emitida', exact: true })).toHaveCount(0);
});

test('permission failure offers retry without exposing tools', async ({ page }) => {
  await fixture(page, 'owner', { failPermissions: true });
  await page.goto('/events/' + eventId);
  await expect(page.getByRole('heading', { name: 'Evento no disponible' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reintentar', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Secciones del evento' })).toHaveCount(0);
});

test('mobile navigation and ticket tools fit the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await fixture(page, 'owner');
  await page.goto('/events/' + eventId);
  await page.getByRole('navigation', { name: 'Secciones del evento' }).getByRole('button', { name: 'Entradas', exact: true }).click();
  await page.getByRole('button', { name: 'Emitir entrada', exact: true }).click();
  await expect(page.getByLabel('Nombre del titular')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Listado', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Emitir entrada', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.screenshot({ path: 'test-results/access-mobile.png', fullPage: true, animations: 'disabled' });
});

test('leaving the scanner releases the camera stream', async ({ page }) => {
  await fixture(page, 'scanner');
  await page.goto('/events/' + eventId);
  await page.getByRole('button', { name: 'Activar cámara', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apagar cámara', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Activar cámara', exact: true })).toBeVisible();
  const tracks = await page.locator('video').evaluateHandle(video => (video.srcObject as MediaStream).getTracks());
  await page.getByRole('navigation', { name: 'Secciones del evento' }).getByRole('button', { name: 'Resumen' }).click();
  expect(await tracks.evaluate(list => list.every(track => track.readyState === 'ended'))).toBe(true);
});

test('bundle shows separate amounts and requires confirmed payment', async ({ page }) => {
  const writes = await fixture(page, 'owner', { priced: true });
  await page.goto('/events/' + eventId);
  await page.getByRole('navigation', { name: 'Secciones del evento' }).getByRole('button', { name: 'Entradas', exact: true }).click();
  await page.getByRole('button', { name: 'Emitir entrada', exact: true }).click();
  const breakdown = page.locator('.price-breakdown');
  await expect(breakdown).toContainText('Concierto');
  await expect(breakdown).toContainText('10');
  await expect(breakdown).toContainText('Transporte');
  await expect(breakdown).toContainText('7');
  expect(await breakdown.locator('dd').allTextContents()).toEqual([
    new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 2 }).format(10000),
    new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 2 }).format(7500),
    new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 2 }).format(17500),
  ]);
  await expect(page.getByRole('combobox', { name: 'Origen', exact: true })).toHaveValue('sinpe');
  await expect(page.getByRole('option', { name: 'Cortesía / acreditación' })).toHaveAttribute('disabled', '');
  await page.getByLabel('Nombre del titular').fill('Compra con transporte');
  await page.getByRole('button', { name: 'Emitir entrada y generar QR' }).click();
  expect(writes).toEqual([]);
  await page.getByLabel('Referencia de pago').fill('SINPE-UI-1');
  await page.getByLabel('Verifiqué el pago antes de emitir esta entrada').check();
  await page.getByRole('button', { name: 'Emitir entrada y generar QR' }).click();
  await expect(page.getByRole('heading', { name: 'Entrada emitida', exact: true })).toBeVisible();
  expect(writes).toEqual(['issue']);
});

test('price editor supports defaults and independent transportation prices', async ({ page }) => {
  const writes = await fixture(page, 'owner', { priced: true });
  await page.goto('/events/' + eventId);
  await page.getByRole('navigation', { name: 'Secciones del evento' }).getByRole('button', { name: 'Entradas', exact: true }).click();
  await page.getByRole('button', { name: 'Tipos de entrada', exact: true }).click();
  await page.getByRole('button', { name: 'Agregar tarifas Santos Rock' }).click();
  await expect(page.getByText('7 tipos agregados.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Editar Fase 1 + transporte' }).click();
  await expect(page.getByLabel('Precio del concierto (CRC)')).toHaveValue('10000');
  await expect(page.getByLabel('Transporte incluido (CRC)')).toHaveValue('7500');
  await page.getByLabel('Precio del concierto (CRC)').fill('13500');
  await page.getByRole('button', { name: 'Guardar tarifa' }).click();
  await expect(page.getByText('Tarifa guardada.', { exact: false })).toBeVisible();
  expect(writes).toEqual(['defaults', 'price']);
});

test('owner sees financial totals, separate transportation, filters and CSV', async ({ page }) => {
  await fixture(page, 'owner');
  await page.goto('/events/' + eventId);
  await page.getByRole('navigation', { name: 'Secciones del evento' }).getByRole('button', { name: 'Finanzas', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Finanzas del evento' });
  await expect(panel.locator('.finance-metrics > div').filter({ hasText: 'Total bruto' }).locator('dd')).toContainText('31');
  await expect(panel.getByText('2 entradas sin importe registrado.', { exact: false })).toBeVisible();
  await expect(panel.getByRole('progressbar')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/finances-desktop.png', fullPage: true, animations: 'disabled' });
  await panel.getByRole('combobox', { name: 'Origen de venta', exact: true }).selectOption('sinpe');
  await expect(panel.getByRole('button', { name: 'Exportar CSV' })).toBeDisabled();
  const query = page.waitForRequest(request => request.url().endsWith('/rpc/get_event_finances') && request.postDataJSON()?.p_source === 'sinpe');
  await panel.getByRole('button', { name: 'Aplicar filtros' }).click();
  expect((await query).postDataJSON()).toMatchObject({ p_event_id: eventId, p_source: 'sinpe', p_from: null, p_to: null });
  await expect(panel.locator('.finance-metrics > div').filter({ hasText: 'Total bruto' }).locator('dd')).toContainText('17');
  const download = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Exportar CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('finanzas-' + eventId + '.csv');
  const { readFile } = await import('node:fs/promises');
  const content = await readFile((await file.path())!, 'utf8');
  expect(content).toContain('Transporte'); expect(content).toContain('7500');
  expect(content).not.toContain('13500');
});

test('supervisor can access finance', async ({ page }) => {
  await fixture(page, 'supervisor');
  await page.goto('/events/' + eventId);
  await page.getByRole('navigation', { name: 'Secciones del evento' }).getByRole('button', { name: 'Finanzas', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Detalle por tipo y concepto' })).toBeVisible();
});

test('event administrator has no financial navigation', async ({ page }) => {
  await fixture(page, 'admin');
  await page.goto('/events/' + eventId);
  const nav = page.getByRole('navigation', { name: 'Secciones del evento' });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Finanzas', exact: true })).toHaveCount(0);
});

test('finance permissions failure shows an error instead of zero revenue', async ({ page }) => {
  await fixture(page, 'owner', { financeError: true });
  await page.goto('/events/' + eventId);
  await page.getByRole('navigation', { name: 'Secciones del evento' }).getByRole('button', { name: 'Finanzas', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('no tiene acceso');
  await expect(page.locator('.finance-metrics')).toHaveCount(0);
});

test('financial panel fits mobile and distinguishes an empty event', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const state = { emptyFinance: false };
  await fixture(page, 'owner', state);
  await page.goto('/events/' + eventId);
  await page.getByRole('navigation', { name: 'Secciones del evento' }).getByRole('button', { name: 'Finanzas', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Detalle por tipo y concepto' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/finances-mobile.png', fullPage: true, animations: 'disabled' });
  state.emptyFinance = true;
  await page.getByRole('region', { name: 'Finanzas del evento' }).getByRole('button', { name: 'Actualizar', exact: true }).click();
  await expect(page.getByText('No hay entradas con estos filtros.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exportar CSV' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('owner must acknowledge test data and enter the exact event name to delete', async ({ page }) => {
  const writes = await fixture(page, 'owner');
  await page.goto('/events/' + eventId);
  await page.getByText('Eliminar evento de prueba', { exact: true }).click();
  const remove = page.getByRole('button', { name: 'Eliminar evento y sus datos', exact: true });
  await expect(remove).toBeDisabled();
  await page.getByLabel('Confirmo que este evento y todas sus ventas son de prueba.').check();
  await page.getByRole('textbox', { name: /^Escriba el nombre exacto del evento/ }).fill('Otro evento');
  await expect(remove).toBeDisabled();
  await page.getByRole('textbox', { name: /^Escriba el nombre exacto del evento/ }).fill(event.name);
  await expect(remove).toBeEnabled();
  await remove.click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: 'Eventos', exact: true })).toBeVisible();
  expect(writes).toEqual(['delete']);
});

test('processing email blocks deletion and supervisor does not see the control', async ({ page }) => {
  await fixture(page, 'owner', { deleteError: true });
  await page.goto('/events/' + eventId);
  await page.getByText('Eliminar evento de prueba', { exact: true }).click();
  await page.getByLabel('Confirmo que este evento y todas sus ventas son de prueba.').check();
  await page.getByRole('textbox', { name: /^Escriba el nombre exacto del evento/ }).fill(event.name);
  await page.getByRole('button', { name: 'Eliminar evento y sus datos', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('correo en procesamiento');
  await expect(page).toHaveURL('/events/' + eventId);
});

test('supervisor has no event deletion control', async ({ page }) => {
  await fixture(page, 'supervisor');
  await page.goto('/events/' + eventId);
  await expect(page.getByRole('navigation', { name: 'Secciones del evento' })).toBeVisible();
  await expect(page.getByText('Eliminar evento de prueba', { exact: true })).toHaveCount(0);
});

async function openDoor(page: Page) {
  await page.goto('/events/' + eventId);
  await page.getByRole('navigation', { name: 'Secciones del evento' }).getByRole('button', { name: 'Venta en puerta', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Entrada', exact: true })).toHaveValue('door');
}

test('door cash sale offers no transport, calculates change and protects the QR', async ({ page }) => {
  await fixture(page, 'owner', { door: true }); await openDoor(page);
  await expect(page.getByLabel(/^Agregar transporte/)).toHaveCount(0);
  await expect(page.getByRole('option', { name: /^Fase 1 \+ transporte/ })).toHaveCount(0);
  await page.getByLabel('Nombre del titular').fill('Venta en puerta');
  await page.getByLabel('Efectivo recibido (CRC)').fill('20000');
  await expect(page.locator('.door-change')).toContainText(new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC' }).format(4000));
  await page.getByLabel('Verifiqué y recibí el pago').check();
  const request = page.waitForRequest(r => r.url().endsWith('/rpc/sell_door_ticket'));
  await page.getByRole('button', { name: /^Registrar venta/ }).click();
  const body = (await request).postDataJSON();
  expect(body).toMatchObject({ p_type_id: 'door', p_payment_method: 'cash', p_cash_received_crc: 20000, p_expected_price_crc: 16000 });
  expect(body).not.toHaveProperty('p_include_transport');
  await expect(page.getByRole('heading', { name: 'Venta registrada' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Siguiente venta' })).toBeDisabled();
  const nav = page.getByRole('navigation', { name: 'Secciones del evento' });
  await expect(nav.getByRole('button', { name: 'Resumen' })).toBeDisabled();
  await page.getByLabel('Confirmo que guardé o entregué el QR').check();
  await page.getByRole('button', { name: 'Siguiente venta' }).click();
  await expect(page.getByLabel('Nombre del titular')).toHaveValue('');
  await expect(page.getByLabel('Verifiqué y recibí el pago')).not.toBeChecked();
});

test('door SINPE requires a reference and excludes free types', async ({ page }) => {
  await fixture(page, 'owner', { door: true }); await openDoor(page);
  await expect(page.getByRole('option', { name: /^Staff/ })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Medio de pago', exact: true }).selectOption('sinpe');
  await expect(page.getByLabel('Efectivo recibido (CRC)')).toHaveCount(0);
  await page.getByLabel('Nombre del titular').fill('Compra SINPE');
  await page.getByLabel('Verifiqué y recibí el pago').check();
  await page.getByRole('button', { name: /^Registrar venta/ }).click();
  await expect(page.getByLabel('Referencia de pago')).toBeVisible();
  await page.getByLabel('Referencia de pago').fill('SINPE-DOOR-1');
  await page.getByLabel('Verifiqué y recibí el pago').check();
  const request = page.waitForRequest(r => r.url().endsWith('/rpc/sell_door_ticket'));
  await page.getByRole('button', { name: /^Registrar venta/ }).click();
  expect((await request).postDataJSON()).toMatchObject({ p_type_id: 'door', p_payment_method: 'sinpe', p_cash_received_crc: null, p_payment_reference: 'SINPE-DOOR-1' });
  await expect(page.getByRole('heading', { name: 'Venta registrada' })).toBeVisible();
});

test('uncertain door sale retries the same request without asking for payment again', async ({ page }) => {
  await fixture(page, 'owner', { door: true, uncertainDoor: true }); await openDoor(page);
  await page.getByLabel('Nombre del titular').fill('Venta pendiente');
  await page.getByLabel('Efectivo recibido (CRC)').fill('20000');
  await page.getByLabel('Verifiqué y recibí el pago').check();
  const first = page.waitForRequest(r => r.url().endsWith('/rpc/sell_door_ticket'));
  await page.getByRole('button', { name: /^Registrar venta/ }).click();
  const original = (await first).postDataJSON();
  await expect(page.getByText('La venta está pendiente de confirmación.', { exact: false })).toBeVisible();
  await expect(page.getByRole('img', { name: 'QR de la entrada vendida en puerta' })).toHaveCount(0);
  const retry = page.waitForRequest(r => r.url().endsWith('/rpc/sell_door_ticket'));
  await page.getByRole('button', { name: 'Reintentar la misma venta' }).click();
  expect((await retry).postDataJSON()).toEqual(original);
  await expect(page.getByRole('heading', { name: 'Venta registrada' })).toBeVisible();
});

test('changed door price requires a new payment confirmation', async ({ page }) => {
  await fixture(page, 'owner', { door: true, staleDoor: true }); await openDoor(page);
  await page.getByLabel('Nombre del titular').fill('Tarifa actualizada');
  await page.getByLabel('Efectivo recibido (CRC)').fill('20000');
  await page.getByLabel('Verifiqué y recibí el pago').check();
  await page.getByRole('button', { name: /^Registrar venta/ }).click();
  await expect(page.getByText('La venta no se registró.', { exact: false })).toBeVisible();
  await expect(page.getByRole('definition').last()).toContainText('17');
  await expect(page.getByLabel('Verifiqué y recibí el pago')).not.toBeChecked();
  await expect(page.getByRole('button', { name: /^Registrar venta/ })).toBeDisabled();
});

test('door sale works on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await fixture(page, 'owner', { door: true }); await openDoor(page);
  await page.getByLabel('Nombre del titular').fill('Venta móvil');
  await page.getByLabel('Efectivo recibido (CRC)').fill('20000');
  await expect(page.getByRole('definition').last()).toContainText('16');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/door-mobile.png', fullPage: true, animations: 'disabled' });
});

async function openTypePrices(page: Page) {
  await page.goto('/events/' + eventId);
  await page.getByRole('navigation', { name: 'Secciones del evento' }).getByRole('button', { name: 'Entradas', exact: true }).click();
  await page.getByRole('button', { name: 'Tipos de entrada', exact: true }).click();
}
test('unused ticket type deletion requires confirmation and refreshes the list', async ({ page }) => {
  const writes = await fixture(page, 'owner', { priced: true }); await openTypePrices(page);
  await page.getByRole('button', { name: 'Eliminar Fase 1 + transporte', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  expect(writes).toEqual([]);
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Eliminar Fase 1 + transporte', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar eliminación', exact: true }).click();
  await expect(page.getByText('Tipo de entrada eliminado.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Eliminar Fase 1 + transporte', exact: true })).toHaveCount(0);
  expect(writes).toEqual(['delete-type']);
});
test('ticket type history blocks deletion and keeps the type visible', async ({ page }) => {
  await fixture(page, 'owner', { priced: true, typeInUse: true }); await openTypePrices(page);
  await page.getByRole('button', { name: 'Eliminar Fase 1 + transporte', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar eliminación', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('ya tiene entradas o importaciones');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Eliminar Fase 1 + transporte', exact: true })).toBeVisible();
});

test('finance columns sort numeric money in both directions with keyboard support', async ({ page }) => {
  await fixture(page, 'owner'); await page.goto('/events/' + eventId);
  await page.getByRole('navigation', { name: 'Secciones del evento' }).getByRole('button', { name: 'Finanzas', exact: true }).click();
  const header = page.getByRole('columnheader', { name: 'Precio unitario', exact: true });
  await header.getByRole('button').click(); await expect(header).toHaveAttribute('aria-sort', 'ascending');
  const table = page.getByRole('table').filter({ has: header });
  await expect(table.locator('tbody tr').first().locator('td').nth(5)).toContainText('7');
  await header.getByRole('button').press('Enter'); await expect(header).toHaveAttribute('aria-sort', 'descending');
  await expect(table.locator('tbody tr').first().locator('td').nth(5)).toContainText('13');
});
test('ticket sort is requested before pagination and resets to the first page', async ({ page }) => {
  await fixture(page, 'owner', { manyTickets: true }); await page.goto('/events/' + eventId);
  await page.getByRole('navigation', { name: 'Secciones del evento' }).getByRole('button', { name: 'Entradas', exact: true }).click();
  const table = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Titular', exact: true }) });
  await expect(table.locator('tbody tr').first()).toContainText('Persona 25');
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await expect(page.getByText('Página 2', { exact: true })).toBeVisible();
  const query = page.waitForRequest(r => r.url().endsWith('/rpc/list_event_tickets_sorted') && r.postDataJSON()?.p_sort_by === 'full_name');
  await table.getByRole('columnheader', { name: 'Titular', exact: true }).getByRole('button').click();
  expect((await query).postDataJSON()).toMatchObject({ p_offset: 0, p_ascending: true });
  await expect(table.locator('tbody tr').first()).toContainText('Persona 01');
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await expect(table.locator('tbody tr').first()).toContainText('Persona 21');
  await table.getByRole('columnheader', { name: 'Titular', exact: true }).getByRole('button').click();
  await expect(table.locator('tbody tr').first()).toContainText('Persona 25');
  await expect(page.getByText('Página 1', { exact: true })).toBeVisible();
});
test('email attempts sort numerically across pages', async ({ page }) => {
  await fixture(page, 'owner', { manyTickets: true }); await page.goto('/events/' + eventId);
  await page.getByRole('navigation', { name: 'Secciones del evento' }).getByRole('button', { name: 'Entradas', exact: true }).click();
  await page.getByRole('button', { name: 'Correos', exact: true }).click();
  const table = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Intentos', exact: true }) });
  await expect(table.locator('tbody tr').first()).toContainText('persona25@');
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await expect(page.locator('.mail-queue').getByText('Página 2', { exact: true })).toBeVisible();
  await table.getByRole('columnheader', { name: 'Intentos', exact: true }).getByRole('button').click();
  await expect(table.locator('tbody tr').first()).toContainText('persona01@');
  await expect(page.locator('.mail-queue').getByText('Página 1', { exact: true })).toBeVisible();
  await table.getByRole('columnheader', { name: 'Intentos', exact: true }).getByRole('button').click();
  await expect(table.locator('tbody tr').first()).toContainText('persona25@');
});
test('CSV preview sorting preserves original row numbers and import order', async ({ page }) => {
  await fixture(page, 'owner'); await page.goto('/events/' + eventId);
  await page.getByRole('navigation', { name: 'Secciones del evento' }).getByRole('button', { name: 'Entradas', exact: true }).click();
  await page.getByRole('button', { name: 'Importar CSV', exact: true }).click();
  await page.locator('.import-panel input[type="file"]').setInputFiles({ name: 'personas.csv', mimeType: 'text/csv', buffer: Buffer.from('nombre,correo,referencia\nZeta,,PAY-1\nAna,,PAY-2\n') });
  const preview = page.locator('.import-preview table');
  await preview.getByRole('columnheader', { name: 'Nombre', exact: true }).getByRole('button').click();
  await expect(preview.locator('tbody tr').first()).toContainText('Ana');
  await expect(preview.locator('tbody tr').first().locator('td').first()).toHaveText('3');
  await page.getByRole('checkbox', { name: /^Revisé las personas/ }).check();
  const query = page.waitForRequest(r => r.url().endsWith('/rpc/import_priced_native_tickets'));
  await page.getByRole('button', { name: 'Importar 2 personas y generar sus QR', exact: true }).click();
  expect((await query).postDataJSON().p_rows.map((r: { name: string }) => r.name)).toEqual(['Zeta', 'Ana']);
});

async function openIssue(page: Page) {
  await page.goto('/events/' + eventId);
  await page.getByRole('navigation', { name: 'Secciones del evento' }).getByRole('button', { name: 'Entradas', exact: true }).click();
  await page.getByRole('button', { name: 'Emitir entrada', exact: true }).click();
  await page.getByLabel('Nombre del titular').fill('Titular de correo');
  await page.getByLabel('Correo (opcional)', { exact: true }).fill('titular@example.com');
}
test('email is opt-in and auto queue displays recipient and paused status', async ({ page }) => {
  let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; });
  const writes = await fixture(page, 'owner', { mailGate: gate }); await openIssue(page);
  const choice = page.getByRole('checkbox', { name: 'Enviar por correo al emitir', exact: true });
  await expect(choice).not.toBeChecked(); await choice.check();
  await expect(page.getByText('Para:', { exact: false }).filter({ hasText: 'titular@example.com' })).toBeVisible();
  const posting = page.waitForRequest(r => r.method() === 'POST' && r.url().includes('queue-ticket-emails'));
  await page.getByRole('button', { name: 'Emitir entrada y generar QR' }).click();
  await posting;
  await expect(page.getByRole('heading', { name: 'Entrada emitida', exact: true })).toBeVisible();
  await page.getByLabel('Confirmo que guardé el QR').check();
  await expect(page.getByRole('button', { name: 'Emitir otra entrada', exact: true })).toBeDisabled();
  release();
  await expect(page.locator('.email-send')).toContainText('Pendiente');
  await expect(page.locator('.email-send')).toContainText('Envíos pausados');
  await expect(page.getByRole('button', { name: 'Emitir otra entrada', exact: true })).toBeEnabled();
  expect(writes).toEqual(['issue','mail']);
});
test('email failure retries only the same mail payload after issuance', async ({ page }) => {
  const writes = await fixture(page, 'owner', { mailFailureOnce: true, mailEnabled: true }); await openIssue(page);
  await page.getByRole('checkbox', { name: 'Enviar por correo al emitir', exact: true }).check();
  const first = page.waitForRequest(r => r.method() === 'POST' && r.url().includes('queue-ticket-emails'));
  await page.getByRole('button', { name: 'Emitir entrada y generar QR' }).click();
  const payload = (await first).postDataJSON();
  await expect(page.locator('.email-send').getByRole('alert')).toContainText('sin emitir otra entrada');
  const second = page.waitForRequest(r => r.method() === 'POST' && r.url().includes('queue-ticket-emails'));
  await page.getByRole('button', { name: 'Reintentar correo', exact: true }).click();
  expect((await second).postDataJSON()).toEqual(payload);
  await expect(page.locator('.email-send')).toContainText('cada 15 minutos');
  expect(writes).toEqual(['issue','mail','mail']);
});
test('email address alone does not automatically queue a message', async ({ page }) => {
  const writes = await fixture(page, 'owner'); await openIssue(page);
  await page.getByRole('button', { name: 'Emitir entrada y generar QR' }).click();
  await expect(page.getByRole('button', { name: 'Programar correo', exact: true })).toBeVisible();
  await expect(page.locator('.email-send')).toContainText('titular@example.com');
  expect(writes).toEqual(['issue']);
});
test('unavailable email keeps QR issuance available', async ({ page }) => {
  const writes = await fixture(page, 'owner', { mailUnavailable: true }); await openIssue(page);
  await expect(page.getByRole('checkbox', { name: 'Enviar por correo al emitir', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Emitir entrada y generar QR' }).click();
  await expect(page.getByRole('heading', { name: 'Entrada emitida', exact: true })).toBeVisible();
  await expect(page.locator('.email-send')).toContainText('Correo no disponible');
  expect(writes).toEqual(['issue']);
});
test('CSV opt-in queues only rows with email and shows destinations', async ({ page }) => {
  await fixture(page, 'owner'); await page.goto('/events/' + eventId);
  await page.getByRole('navigation', { name: 'Secciones del evento' }).getByRole('button', { name: 'Entradas', exact: true }).click();
  await page.getByRole('button', { name: 'Importar CSV', exact: true }).click();
  await page.locator('.import-panel input[type="file"]').setInputFiles({ name: 'mail.csv', mimeType: 'text/csv', buffer: Buffer.from('nombre,correo,referencia\nCon correo,titular@example.com,PAY-1\nSin correo,,PAY-2\n') });
  await page.getByRole('checkbox', { name: 'Enviar por correo al importar', exact: true }).check();
  await page.getByRole('checkbox', { name: /^Revisé las personas/ }).check();
  const query = page.waitForRequest(r => r.method() === 'POST' && r.url().includes('queue-ticket-emails'));
  await page.getByRole('button', { name: 'Importar 2 personas y generar sus QR', exact: true }).click();
  expect((await query).postDataJSON().items).toHaveLength(1);
  await expect(page.locator('.email-send')).toContainText('titular@example.com');
  await expect(page.locator('.email-send')).toContainText('Pendiente');
});
test('reissue shows registered recipient and can queue the new QR', async ({ page }) => {
  await fixture(page, 'owner'); await page.goto('/events/' + eventId);
  await page.getByRole('navigation', { name: 'Secciones del evento' }).getByRole('button', { name: 'Entradas', exact: true }).click();
  await page.getByRole('button', { name: 'Reemitir QR', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Acción sobre la entrada' });
  await expect(panel).toContainText('titular@example.com');
  await panel.getByRole('checkbox', { name: 'Enviar el nuevo QR por correo', exact: true }).check();
  await panel.getByRole('textbox', { name: 'Motivo', exact: true }).fill('Reemisión de prueba');
  await panel.getByRole('checkbox', { name: 'Confirmo la operación sobre esta entrada sin usar', exact: true }).check();
  await panel.getByRole('button', { name: 'Invalidar QR anterior y generar nuevo', exact: true }).click();
  await expect(panel.locator('.email-send')).toContainText('Pendiente');
});

test('mail-ux door delivery programs only after payment confirmation', async ({ page }) => {
  const writes = await fixture(page, 'owner', { door: true }); await openDoor(page);
  await page.getByText('Agregar correo del titular', { exact: true }).click();
  await page.getByLabel('Correo (opcional)', { exact: true }).fill('titular@example.com');
  await page.getByRole('checkbox', { name: 'Enviar por correo al emitir', exact: true }).check();
  await page.getByLabel('Nombre del titular').fill('Titular de puerta');
  await page.getByLabel('Efectivo recibido (CRC)').fill('20000');
  await page.getByRole('checkbox', { name: 'Verifiqué y recibí el pago', exact: true }).check();
  await page.getByRole('button', { name: /^Registrar venta/ }).click();
  await expect(page.getByRole('heading', { name: 'Venta registrada' })).toBeVisible();
  await expect(page.locator('.email-send')).toContainText('Pendiente');
  await expect(page.locator('.email-send')).toContainText('titular@example.com');
  expect(writes).toEqual(['door','mail']);
});
test('mail-ux provider acceptance is not presented as confirmed delivery', async ({ page }) => {
  await fixture(page, 'owner', { mailStatus: 'submitted', mailEnabled: true }); await openIssue(page);
  await page.getByRole('checkbox', { name: 'Enviar por correo al emitir', exact: true }).check();
  await page.getByRole('button', { name: 'Emitir entrada y generar QR' }).click();
  await expect(page.locator('.email-send')).toContainText('Aceptado por Brevo');
  await expect(page.locator('.email-send')).toContainText('La entrega en la bandeja aún no está confirmada.');
});
