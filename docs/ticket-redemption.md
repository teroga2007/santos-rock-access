# Canje y escáner — 3 de noviembre de 2026

Migración 007: `set_event_status` y `redeem_ticket`. Control de ingreso en el detalle del evento, con cámara, archivo de imagen y código manual.

Aplicada al proyecto `santos-rock-access` el 3 de noviembre de 2026, tras pasar las pruebas transaccionales y comprobar con dry-run que era la única pendiente. Historial remoto verificado hasta 007.

## Probar con el QR guardado

1. Abrir el detalle de un evento de prueba como administrador.
2. Publicar evento y confirmar. Luego Iniciar ingreso y confirmar. El estado debe decir En vivo.
3. En Control de ingreso, activar cámara o cargar el PNG del QR guardado. **La lectura de un QR válido registra el ingreso inmediatamente.** Usar una entrada de prueba.
4. Primera lectura: Ingreso autorizado, tipo, zona y hora registrada.
5. Presionar Siguiente lectura, volver a cargar/escanear el mismo QR: Entrada ya utilizada, con la hora del ingreso original.
6. Como administrador/supervisor, el listado de entradas debe mostrar Utilizada; se actualiza tras la aceptación en esta pantalla. Otros dispositivos requieren Actualizar entradas.
7. Apagar cámara al terminar. Cerrar ingreso solo cuando corresponda: impide canjes y emisiones y no hay reapertura desde la aplicación.

La cámara exige HTTPS o localhost y permiso del navegador. Acceder al servidor de desarrollo por HTTP desde la IP de una computadora no suele permitir cámara. La carga de imagen permite probar en la misma computadora sin cámara. El lector se carga al activarlo; no transmite imágenes a un servicio externo.

## Seguridad y operación

- Org owner/admin y evento admin/supervisor/scanner pueden canjear en sus eventos. Solo administradores pueden cambiar estado.
- Transiciones: draft → published → live → closed; draft/published también admiten cancelled mediante RPC. No hay reapertura ni UI de cancelación en esta fase.
- Solo un evento live acepta nuevos canjes. El inicio es manual: no se activa por calendario.
- Se identifica el token nativo por SHA-256. Se bloquea la entrada durante la validación y actualización, con índice único de aceptación como protección adicional. El evento se bloquea en lectura para coordinar cambios de estado.
- Resultados: accepted, duplicate, invalid, void, wrong_event y error/event_not_live. Una entrada de otro evento no revela tipo, zona ni titular.
- La respuesta al operador contiene únicamente resultado, tipo/zona y hora de ingreso para accepted/duplicate. No expone nombre, correo, listado de tickets ni credencial.
- Cada lectura tiene un request_id. Mismo operador/evento/token/request_id devuelve el resultado original sin duplicar check-in ni auditoría. Cambiar parámetros con el mismo ID se rechaza.
- El navegador bloquea lecturas hasta presionar Siguiente lectura. Un reintento de red conserva el request_id y el token en memoria. Sin confirmación del servidor, no se autoriza acceso; no hay modo offline.
- Antes de abandonar una petición pendiente se solicita confirmación del navegador. Si se fuerza el cierre y pierde el request_id, una lectura posterior devuelve duplicate si el canje original se confirmó. Requiere revisión de un supervisor; no autorizar una excepción automática.
- Límite por operador: 180 nuevas solicitudes/minuto, coordinado entre dispositivos. Reintentos idénticos no consumen nuevas solicitudes. No sustituye controles de infraestructura.
- Se auditan resultados de lecturas válidas para RPC, sin guardar el token original. Los códigos con formato inválido se rechazan localmente; credenciales desconocidas o de otro evento se registran en la tabla privada de solicitudes y auditoría, no en checkins porque esa tabla requiere una entrada del evento.
- Los checkins guardan operador y hora. La asociación de dispositivos/puestos con la tabla scanners aún no se implementa.
- Revocación y anulación se respetan en el canje; todavía no hay interfaz para ejecutarlas.

## Verificación

- Compilación TypeScript/Vite correcta, escáner y lector cargados bajo demanda.
- QR PNG de prueba generado con la misma librería de emisión y decodificado correctamente mediante el núcleo ZXing. No sustituye la prueba de cámara e interacción en navegador.
- `supabase/tests/ticket_redemption.sql` se ejecutó con la migración en una transacción revertida antes de aplicarla. Crea cuentas y entradas aleatorias y verifica: borrador bloqueado, transiciones y permisos, aceptación, reintento idéntico, duplicado, request_id con parámetros distintos, anulación/revocación, evento incorrecto, token desconocido, evento no asignado, credenciales inaccesibles, evento cerrado, estado redeemed y auditoría sin duplicados. No quedaron fixtures.
- Pendientes: lectura real con cámara/imagen, sesión JWT de personal de puerta, pérdida de conexión y pruebas de estrés con varios escáneres simultáneos. Las pruebas SQL simulan claims y son secuenciales.

No se validan códigos de LaTiqueteraCR. No se ha implementado offline, reapertura, envío de correos ni excepciones de supervisor.
