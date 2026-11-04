# Continuar en otra conversación: Brevo, GoDaddy y Netlify

## Estado confirmado por el usuario

Estado más reciente, 3 de noviembre de 2026: integración configurada y probada, UX publicada y **envíos habituales activos**, con límite de **80 intentos diarios**. Consultar [flujo actual y activación](../features/mail-ux.md) y [auditoría de la prueba inicial](../operations/mail-production-audit.md). Las secciones siguientes son históricas y describen el punto de partida; sus instrucciones de configuración inicial no deben interpretarse como una orden de volver a pausar producción.

- Dominio principal: `santosrock.com`, registrado en GoDaddy.
- Buzones actuales: Microsoft, sobre el dominio principal.
- Aplicación prevista: `https://access.santosrock.com`, alojada en Netlify.
- Proveedor elegido: Brevo Free. Volumen previsto: 100 correos diarios o menos. La app limita inicialmente a **80 intentos diarios**, configurables.
- **Todavía no se creó la cuenta de Brevo ni el subdominio en GoDaddy.** El usuario pidió configurar todo paso a paso en otra conversación.
- Aún falta elegir el buzón existente de Microsoft para `Reply-To`.

## Qué está implementado

Migración 011: cola persistente, destinatario tomado del titular, verificación de permisos y credencial, deduplicación, reserva de cupo por día UTC, leases del worker, reintentos de errores conocidos y estados inciertos sin reenvío automático.

Aplicada a Supabase `santos-rock-access` el 3 de noviembre de 2026, después de preflight con rollback y dry-run. La suite SQL ampliada pasó nuevamente tras aplicarla; no quedaron trabajos, titulares ni presupuestos de prueba. Compilación frontend correcta; 6 pruebas de correo y 7 de CSV correctas. No se ha probado todavía una función desplegada ni un envío real.

Funciones de Netlify:

- `queue-ticket-emails`: autentica el JWT de Supabase, cifra el token con AES-256-GCM y agrega trabajos usando una clave privada de Supabase.
- `send-ticket-emails`: tarea programada cada 15 minutos, procesa hasta 3 trabajos por ejecución y usa la API transaccional de Brevo. Exige `MAIL_SENDING_ENABLED=true`; por defecto no envía.

La UI permite solicitar entrega por correo al emitir una entrada, reemitir su QR o terminar una importación CSV. En CSV solo se incluyen filas con correo. El listado «Cola de correos» muestra destinatario, estado e intentos y permite reintentar errores explícitos. No muestra tokens, ciphertext ni secretos.

**No se envió ningún correo real ni se desplegaron estas funciones en Netlify durante el desarrollo de esta fase.** Las pruebas del proveedor están interceptadas con mocks. No se verificó dominio ni se cambiaron DNS.

## Orden recomendado para la conversación de configuración

1. Crear la cuenta gratuita de Brevo y verificar el acceso; revisar que el envío transaccional esté habilitado.
2. Elegir remitente. Propuesta: `pases@entradas.santosrock.com`. Este subdominio de correo es distinto de `access.santosrock.com`, reservado para la web.
3. Localizar dónde están los DNS autoritativos (que el registrador sea GoDaddy no asegura que aloje la zona DNS).
4. Agregar **los valores exactos que muestre Brevo** para verificar el dominio y su autenticación. No inventar registros ni crear un segundo SPF en el mismo nombre. Conservar los registros MX que reciben el correo principal en Microsoft.
5. Agregar el proyecto a Netlify, configurar build `npm run build` y directorio `dist` según `netlify.toml`.
6. Crear el registro web para `access` usando el destino exacto indicado por Netlify, activar HTTPS y verificar carga/login.
7. Actualizar las URL permitidas de Supabase Auth para el dominio definitivo y `/auth/accept`.
8. Configurar las variables de la siguiente sección en Netlify. Mantener el envío desactivado inicialmente.
9. Probar la cola con **una entrada de prueba y una dirección controlada por el usuario**. Luego activar el envío y verificar recepción del PNG y lectura del QR. El agente no debe mandar correos a terceros sin instrucción expresa.

## Variables

Plantilla: `backend/.env.example`. No contiene valores reales. Las variables privadas deben tener alcance Functions y nunca llevar prefijo `VITE_`.

| Variable | Uso |
| --- | --- |
| `VITE_SUPABASE_URL` | Build del frontend |
| `VITE_SUPABASE_PUBLISHABLE_KEY` o `VITE_SUPABASE_ANON_KEY` | Clave pública para build del frontend |
| `SUPABASE_URL` | URL del proyecto para las funciones |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave privada del proyecto, solo servidor |
| `MAIL_QUEUE_ENCRYPTION_KEY` | 32 bytes aleatorios, codificados como 64 caracteres hexadecimales |
| `BREVO_API_KEY` | Clave de API transaccional, no contraseña SMTP |
| `EMAIL_FROM` | Remitente verificado por Brevo |
| `EMAIL_FROM_NAME` | Santos Rock |
| `EMAIL_REPLY_TO` | Buzón existente de Microsoft, pendiente de elección |
| `APP_ORIGIN` | `https://access.santosrock.com` |
| `EMAIL_DAILY_LIMIT` | `80` inicialmente; la aplicación admite 1–250 |
| `MAIL_SENDING_ENABLED` | `false` hasta terminar las pruebas de configuración |

Generar la clave de cifrado localmente, sin pegarla en el chat:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Conservarla de forma segura. Cambiarla mientras haya trabajos pendientes impide descifrarlos. Nunca introducir claves privadas en variables VITE ni subirlas al repositorio.

## Límites operativos

- La cuota es **global para esta app y por día UTC**: a las 18:00 de Costa Rica empieza un nuevo día UTC. Cuenta reservas/intentos, no solo aceptaciones. No conoce otros correos que se envíen desde la misma cuenta de Brevo, incluidos los de Supabase Auth si luego comparten proveedor.
- Los pendientes no reservados quedan para el día siguiente cuando se agota el cupo. La tarea programada no funciona automáticamente en Vite ni en previews; requiere despliegue de producción de Netlify. Para probar servidor local, usar Netlify Dev y variables privadas locales, y ajustar APP_ORIGIN al origen local exacto.
- «Aceptado por Brevo» significa que su API aceptó el mensaje, **no** que se entregó en la bandeja. Aún no se integraron webhooks de rebote/entrega.
- Un rechazo HTTP 4xx puede reintentarse explícitamente después de corregirlo. Una respuesta 5xx o fallo de red queda «Revisar en Brevo». Un worker interrumpido queda incierto al pasar 15 minutos. No hay reintento automático de esos casos.
- Antes de cada envío se comprueba que la entrada siga sin usar, el QR sea vigente, el evento no esté cerrado/cancelado, el correo no haya cambiado y el actor conserve permisos. Las entradas no válidas se cancelan en la cola. Una modificación concurrente justo después de comprobar puede producir un correo con QR ya inválido; el canje sigue siendo la autoridad.
- El token se conserva cifrado solo mientras esté pendiente/procesándose o con un fallo corregible. Se elimina al quedar aceptado, cancelado o incierto. No permite descargar nuevamente el QR desde la cola.
- Para poner en cola una entrada antigua cuyo QR ya no esté en memoria, usar reemisión controlada si sigue sin utilizar. No crear una entrada adicional para el mismo acceso.
- Supabase Auth (invitaciones y recuperación) requiere su propia configuración SMTP en el panel. Este módulo no la modifica.

## Pruebas disponibles

`npm run test:mail`: cifrado, manipulación del envelope, configuración desactivada, HTML escapado, PNG, autenticación, cola, aceptación de proveedor, rechazo, fallo de red, 5xx y entrada obsoleta, sin correos reales.

SQL: combinar migración 011, `ticket_redemption.sql` sin rollback final, `email_queue_assertions.sql` y rollback para preflight; después de aplicarla, omitir la migración. La suite usa claims simulados y presupone un presupuesto UTC vacío: repetir en staging, no con envíos reales activos. Comprueba permisos, ciphertext no legible por frontend, destinatario canónico, idempotencia, cupo diario, leases, cancelación, limpieza de payload, auditoría y reintentos.

Fuentes oficiales de configuración: [Brevo API](https://developers.brevo.com/reference/send-transac-email), [Netlify Scheduled Functions](https://docs.netlify.com/build/functions/scheduled-functions/).
