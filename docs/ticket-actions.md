# Anulación y reemisión — fase 009

Migración 009 aplicada a `santos-rock-access` el 3 de noviembre de 2026, tras preflight y dry-run. La suite ampliada pasó después de aplicarla, con rollback de todos los fixtures.

El listado de entradas incluye acciones para administradores de evento y propietarios/administradores de organización. Supervisores y personal de puerta no pueden ejecutarlas.

## Reemitir un QR perdido

1. Elegir una entrada de prueba **Emitida**, sin ingresos, en un evento que no esté cerrado/cancelado.
2. Presionar Reemitir QR, escribir un motivo de al menos 5 caracteres y confirmar.
3. Descargar el nuevo QR y confirmar que fue guardado antes de terminar.
4. En un evento En vivo, el QR anterior devuelve Entrada anulada; el nuevo permite un solo ingreso.

Se conserva el ID de entrada, titular, origen, tipo, orden y cupo. La operación revoca todos los códigos anteriores e incorpora uno nuevo; no crea otra entrada. El nuevo token solo vive en memoria del navegador y el PNG, mientras la base guarda su SHA-256. No se recupera el token previo ni se envían correos.

Si el navegador se cierra y se pierde el nuevo QR, un administrador puede volver a reemitir mientras la entrada siga sin usar. Cada reemisión invalida los códigos anteriores. Reintentar una solicitud ya confirmada devuelve su resultado histórico y no reactiva credenciales revocadas por operaciones posteriores.

## Anular

1. Elegir una entrada Emitida, presionar Anular y proporcionar motivo/confirmación.
2. La entrada pasa a Anulada, sus credenciales quedan revocadas y el cupo del tipo se libera.
3. Los QR anteriores ya no autorizan ingreso. El dashboard actualiza pendientes/anuladas y cupo disponible.

La anulación se permite también con evento cerrado para corrección administrativa. No resta ingresos porque las entradas utilizadas no se pueden anular. No devuelve pagos ni cambia el estado financiero de la orden. No hay restauración desde la aplicación.

## Seguridad y consistencia

- RPC `manage_ticket_credential`: verifica permisos efectivos del evento y exige motivo de 5–300 caracteres. No pegar tokens, contraseñas ni información sensible en el motivo.
- Solo entradas propias con credencial nativa y estado issued. LaTiqueteraCR queda fuera del flujo.
- Reemisión bloqueada para eventos closed/cancelled. Entradas redeemed/void rechazan ambas acciones.
- Una transacción coordina credenciales, estado y auditoría. Usa el mismo orden de bloqueos que el canje para que una entrada no pueda reemitirse después de haber ingresado.
- UUID por solicitud más huella de parámetros y actor: reintentos idénticos no duplican cambios. Otra entrada, motivo, acción, token o actor con el mismo ID se rechaza.
- Auditoría: `ticket.voided` o `ticket.credential_reissued`, con motivo, actor, entrada y request_id, sin token original.
- Cambios pendientes y QR sin guardar bloquean los controles de estado del evento y generan advertencia al abandonar el navegador.

## Verificación

`npm run build`: correcto. Suite SQL: combinar `ticket_redemption.sql` sin rollback final y `ticket_actions_assertions.sql`, terminar con rollback. Antes de aplicar 009 se probó la migración dentro de la misma transacción. Casos: identidad de entrada conservada, token previo revocado, nuevo QR aceptado, reintentos, parámetros cambiados, token duplicado con rollback íntegro, evento cerrado, rechazo de scanner/supervisor, entradas utilizadas protegidas, anulación, cupo liberado y auditoría única. La suite ampliada comprueba además acceso de administrador de evento y rechazo sobre otro evento.

Pendiente revisión visual y funcional con la sesión del usuario y prueba concurrente de canje contra anulación/reemisión. Las pruebas SQL usan claims simulados y no sustituyen pruebas con JWT reales.
