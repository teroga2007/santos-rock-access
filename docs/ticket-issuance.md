# Emisión de entradas — 3 de noviembre de 2026

El detalle del evento incluye tipos de entrada, emisión individual y listado paginado de entradas propias. No hay integración con LaTiqueteraCR ni envío de correos en esta fase.

Migración `202611030006_ticket_issuance.sql` aplicada a `santos-rock-access` el 3 de noviembre de 2026, después de pruebas con rollback y dry-run que confirmó que era la única pendiente.

## Uso

1. Entrar como administrador de evento o propietario/administrador de organización.
2. Abrir un evento → Entradas y acreditaciones → Configurar un tipo de entrada.
3. Crear General, Banda, Prensa o Producción, con zona y cupo opcional. Cero significa sin disponibilidad; vacío significa sin límite. El cupo es por tipo, no un aforo global del evento.
4. Seleccionar tipo, nombre y origen; correo opcional. SINPE y puerta requieren una referencia y confirmación manual de que el pago fue verificado. La aplicación no consulta bancos ni confirma pagos automáticamente.
5. Emitir, descargar el PNG del QR y confirmar que fue guardado antes de emitir otra entrada. Cada emisión corresponde a una persona/acceso.

El QR contiene una credencial aleatoria opaca, no una URL pública ni datos personales. El canje y escáner se incorporaron en la migración 007; ver [control de ingreso](ticket-redemption.md). El archivo descargado contiene únicamente el QR; el titular e identificador se muestran en la pantalla para organizar la entrega manual.

## Permisos y datos

- Administradores de evento y de organización: crear tipos y emitir entradas.
- Supervisores: consultar el listado de titulares, tipos y estados, sin credenciales.
- Personal de puerta: no accede al listado de entradas ni titulares; la futura RPC de canje expondrá solo información acotada.
- Tipos de otros eventos, eventos cerrados/cancelados y cupos llenos se rechazan en la base de datos.
- LaTiqueteraCR se excluye de la emisión nativa. Sus códigos requieren integración acordada.
- Credenciales, titular, orden si aplica, entrada y auditoría se escriben de forma atómica. La base guarda SHA-256 del token; el token original no se registra en tablas ni auditoría.
- El navegador genera 32 bytes aleatorios mediante Web Crypto. Conserva token y QR solo en memoria durante la emisión, sin localStorage ni URLs. Usa HTTPS o localhost.
- Cada solicitud incluye un UUID y una huella de sus parámetros. Un reintento idéntico devuelve la entrada existente; otro contenido o actor con ese UUID se rechaza. Los reintentos conservan la misma solicitud en pantalla.
- El bloqueo del tipo serializa la comprobación de cupo y emisión. Las pruebas realizadas no incluyen estrés concurrente.

## Recuperación y límites

El listado no permite reconstruir los QR. Hay advertencia antes de abandonar una emisión pendiente o un QR no guardado, pero un cierre forzado o caída del navegador puede perderlo. No emitir otra entrada para sustituir un QR perdido: usar la [reemisión controlada](ticket-actions.md), disponible para entradas sin usar. Si la conexión falla, reintentar desde la misma pantalla. Si se cerró, revisar el listado antes de actuar.

No se ha implementado envío por correo. El canje y cambio de estado están descritos en la fase 007; anulación y reemisión, en la fase 009; importación CSV, en la fase 010.

## Verificación

- `npm run build`: correcto, QR cargado bajo demanda.
- `supabase/tests/ticket_issuance.sql`: ejecutado con la migración 006 en una sola transacción que termina en rollback en el proyecto vinculado. Prueba emisión, reintento idéntico, parámetros cambiados, capacidad, tipo de otro evento, pago sin referencia, listado, credencial no seleccionable, rechazo de scanner, huella SHA-256 y auditoría única. No quedan fixtures ni entradas de prueba.
- Pendiente verificación visual en navegador con una cuenta real y pruebas de concurrencia. La prueba SQL simula el usuario con claims; no sustituye las comprobaciones con JWT reales.
- Suite ampliada ejecutada nuevamente tras aplicar 006, también con rollback: comprueba orden SINPE verificada, rechazo de emisión nativa de LaTiqueteraCR, emisión/tipos bloqueados con evento cerrado y listado permitido a supervisores sin permiso de crear tipos.
