# Panel de control — fase 008

Migración `202611030008_event_dashboard.sql` aplicada a `santos-rock-access` el 3 de noviembre de 2026, después de preflight transaccional y dry-run. La suite ampliada, incluido evento vacío, pasó también después de la aplicación; todos los fixtures se revirtieron.

En el detalle de cada evento, propietarios/administradores y supervisores pueden consultar:

- Entradas emitidas históricas, ingresos, pendientes y anuladas.
- Porcentaje de ingreso sobre entradas vigentes: `redeemed / (issued + redeemed)`. No es aforo del recinto.
- Desglose por origen y por tipo/zona.
- Cupo disponible por tipo: capacidad menos emitidas vigentes (issued + redeemed). Los tipos sin capacidad se muestran sin límite.
- Últimas 15 solicitudes de lectura confirmadas por el servidor, sin nombres, correos, credenciales ni identificadores de operadores.

Cada solicitud se cuenta una sola vez aunque se reintente. Una lectura duplicada nueva se muestra en actividad, pero no suma ingresos. Los códigos que el dispositivo rechaza por formato no llegan al servidor. Las entradas con credencial revocada que aún tengan status issued cuentan como pendientes hasta que se anule también la entrada; los conteos se basan en estado de ticket, no en credenciales.

## Actualización y permisos

Se consulta cada 15 segundos mientras la pestaña esté visible; se pausa en segundo plano y consulta al volver. También hay botón Actualizar y se solicita actualización después de crear tipos, emitir o canjear desde la misma pantalla y tras cambios de estado. Si ya había una consulta en curso, la siguiente automática recoge el cambio.

No es una suscripción Realtime ni un modo offline. Los datos previos se conservan con aviso si falla la conexión. La hora de última consulta está visible en Costa Rica. La RPC devuelve todos los totales, desgloses y actividad usando una misma instantánea de PostgreSQL.

El personal de puerta no ve el panel y la RPC rechaza el acceso. Un supervisor no puede consultar eventos que no tiene asignados. La función no concede acceso a la tabla privada de solicitudes ni cambia las políticas de lectura de tickets o titulares.

## Verificación

- `npm run build`: correcto; panel cargado bajo demanda.
- Pruebas SQL con fixtures aleatorios, rollback y sin datos persistentes: se combina `ticket_redemption.sql` sin su rollback final con `event_dashboard_assertions.sql`, seguido de rollback. Comprueba totales tras canje/anulación, fuentes, tipos, no duplicación por reintentos, aislamiento entre eventos, ausencia de campos sensibles, denegación a scanner y acceso de supervisor solo a su evento. Incluye evento vacío con totales cero.
- Pendiente revisión visual y actualización entre dos navegadores con sesiones reales. Las pruebas SQL usan claims simulados y no sustituyen esa comprobación.

La cámara real y el rechazo del segundo uso del QR fueron confirmados por el usuario antes de esta fase. Continúan pendientes pruebas concurrentes de varios escáneres, correo e importación CSV.
