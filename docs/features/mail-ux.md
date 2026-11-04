# Entrega de entradas por correo

## Recorrido

El correo es opcional. Al registrar una dirección válida aparece **Enviar por correo al emitir**. Está desmarcado inicialmente; escribir una dirección por sí solo no programa ningún mensaje. Si se modifica la dirección, se vuelve a solicitar esa elección.

Después de una emisión confirmada, el sistema programa el correo cuando el operador eligió esa opción. Muestra el destinatario y el estado. Si no se eligió, sigue disponible **Programar correo** junto al QR. En puerta, el correo queda en el bloque opcional del titular.

En CSV, **Enviar por correo al importar** muestra la cantidad de entradas con correo y permite revisar los destinatarios. Solo se programan las filas con dirección válida; las demás conservan entrega manual del QR. Ordenar la vista previa no cambia la correspondencia entre filas y destinatarios.

En reemisión se consulta el correo registrado mediante una RPC limitada a administradores del evento; se ofrece **Enviar el nuevo QR por correo**. El backend continúa seleccionando el destinatario canónico y comprobando que la credencial siga vigente: la dirección presentada por el frontend no cambia el destinatario de la API.

## Estados y recuperación

- **Pendiente**: registrado en cola; no equivale a enviado.
- **Procesando**: tomado por el proceso de envío.
- **Aceptado por Brevo**: el proveedor aceptó la solicitud; no confirma la recepción en bandeja.
- **Rechazado / error**, **Requiere revisión** y **Cancelado**: el operador debe consultar el detalle en Entradas → Correos. Se conserva la política de no reenviar automáticamente resultados inciertos.

La cola se revisa cada 15 minutos y procesa hasta tres trabajos por ejecución. El plazo puede ser mayor por pendientes o límite diario. El límite de la aplicación se muestra como intentos diarios en la ayuda desplegable.

Una emisión correcta se conserva si falla el correo. **Reintentar correo** vuelve a utilizar los mismos IDs de entrada y credenciales, sin repetir emisión ni cobro. Los errores inciertos se describen como falta de confirmación, sin afirmar que el correo no quedó registrado.

La programación automática se intenta una sola vez por resultado; los reintentos posteriores son explícitos. Mientras se registra el correo, se bloquean acciones que descartarían la pantalla. Se mantiene la confirmación de guardar o entregar el QR como respaldo.

Si el servicio está pausado, tanto la elección como el resultado lo indican. Si no se puede consultar su configuración, la emisión y entrega manual siguen disponibles. La tabla de Correos se actualiza cada 30 segundos mientras la página está visible, además del botón manual.

## Validación y activación

La migración 018 solo agrega `get_ticket_email_recipient`, con validación de permisos y sin abrir lectura general de titulares. Se verificó con fixtures y rollback: correo correcto, ausencia de correo, supervisor sin acceso y aislamiento entre organizaciones.

Pruebas de UI con servicios simulados: selección voluntaria, destinatario visible, cola pausada, reintento sin reemisión, servicio no disponible, CSV parcial, reemisión, puerta y aceptación sin falsa confirmación de entrega. Se conservaron las pruebas de cifrado, JWT, presupuesto, PNG y resultados inciertos con proveedor simulado. No se enviaron correos reales durante las pruebas.

Antes de activar se confirmó que la cola de producción estaba vacía y el límite era 80 intentos diarios. La activación habitual y publicación se realizan después de completar las comprobaciones; no se reponen trabajos de pruebas eliminados.

Publicación completada el 3 de noviembre de 2026: despliegue `6aea984f03f8eec3d55d4a76`, confirmado como publicado y `ready` mediante la API de Netlify. `MAIL_SENDING_ENABLED=true` y `EMAIL_DAILY_LIMIT=80`, verificados después de publicar. Esta activación habitual sucede tras la aceptación del usuario de mejorar el flujo y activarlo; sustituye el estado pausado que se había conservado tras la prueba inicial.

Verificación de este incremento: 38 recorridos de interfaz correctos (36 de la suite y dos casos finales de puerta/aceptación), nueve pruebas de correo con proveedor simulado, SQL con rollback y compilación final correcta. La migración 018 está aplicada. No se fabricaron entradas ni trabajos reales para probar la activación.

La confirmación automática de entregas o rebotes mediante webhooks sigue pendiente. Las claves, cifrado, DNS y configuración de Microsoft mantienen su flujo existente.
