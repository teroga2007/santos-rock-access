import { test, expect, type Page } from '@playwright/test';

const eventId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const organizationId = '33333333-3333-4333-8333-333333333333';
const ticketId = '44444444-4444-4444-8444-444444444444';
const event = { id: eventId, organization_id: organizationId, name: 'Encuentro Santos Rock', venue: 'Los Santos', starts_at: '2027-01-16T22:00:00Z', ends_at: null, timezone: 'America/Costa_Rica', status: 'live' };

async function fixture(page: Page, role: string, options: { failPermissions?: boolean; uncertainIssue?: boolean } = {}) {
  const writes: string[] = [];
  let redeemed = false;
  await page.route('https://**.supabase.co/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const respond = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path.endsWith('/events')) return respond(url.searchParams.get('id') ? event : [event]);
    if (path.endsWith('/organizations')) return respond(url.searchParams.get('id') ? { name: 'Santos Rock' } : [{ id: organizationId, name: 'Santos Rock' }]);
    if (path.endsWith('/organization_members')) {
      if (options.failPermissions) return respond({ code: '42501', message: 'Forbidden' }, 403);
      return respond([{ user_id: userId, organization_id: organizationId, role: role === 'owner' ? 'owner' : 'member' }]);
    }
    if (path.endsWith('/event_members')) return respond(role === 'owner' ? [] : [{ user_id: userId, role }]);
    if (path.endsWith('/ticket_types')) return respond([{ id: 'general', name: 'General', capacity: 999, access_zone: 'general' }]);
    if (path.endsWith('/ticket_email_jobs')) return respond([]);
    if (path.endsWith('/rpc/get_event_dashboard')) return respond({ generated_at: '2026-11-03T18:00:00Z', event_status: event.status, totals: { total: 10, admitted: 3, pending: 7, voided: 0 }, sources: [], types: [], recent: [] });
    if (path.endsWith('/rpc/list_event_tickets')) return respond([{ id: ticketId, full_name: 'Persona invitada', type_name: 'General', source: 'complimentary', status: 'issued', issued_at: '2026-11-03T18:00:00Z' }]);
    if (path.endsWith('/rpc/issue_ticket')) {
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
  await page.route('**/.netlify/functions/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ configured: true, sending_enabled: false, daily_limit: 80 }) }));
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
  await expect(nav.getByRole('button')).toHaveText(['Resumen', 'Ingreso', 'Entradas', 'Equipo']);
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
  await expect(nav.getByRole('button')).toHaveText(['Resumen', 'Ingreso', 'Entradas']);
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
