# Auditoría de correo en producción — 3 de noviembre de 2026

## Alcance y límites

Revisión de la integración existente, sin reconstruir la arquitectura ni modificar la migración 011, DNS o Microsoft 365. Mantener `MAIL_SENDING_ENABLED=false` hasta autorización expresa para una única prueba dirigida a un correo controlado por el usuario.

## Hallazgos confirmados

- Sitio: `access.santosrock.com`, Netlify `santos-rock-access`, equipo `asocul-santosrock`. Repositorio conectado a GitHub main. Build `npm run build`, publicación `dist`.
- La protección de acceso de Netlify devuelve HTTP 401 y una página de login antes de llegar al frontend/funciones en peticiones públicas. Ese 401 no es una respuesta de `queue-ticket-emails` ni de Brevo. Se conservó la protección.
- Funciones desplegadas en Node 24, worker con cron `*/15 * * * *`, región de funciones cmh. Programación válida según Netlify.
- Variables requeridas presentes con scopes Functions y contexto production/all. `EMAIL_DAILY_LIMIT=80`, `MAIL_SENDING_ENABLED=false`, remitente y origen coinciden con lo solicitado.
- Las tres claves privadas están marcadas como secretas. La API de Netlify devuelve máscaras parciales; esas máscaras **no permiten validar las claves ni consultar Brevo** y no deben confundirse con valores reales inválidos.
- El usuario confirmó en Brevo que `pases@entradas.santosrock.com` está activo/verificado. No se comprobó la autorización de la clave de envío mediante un correo real.
- Supabase: migración 011 aplicada, RLS activo, authenticated sin lectura de ciphertext ni ejecución de RPC de alta/claim; service_role con ejecución permitida. Consulta inicial: cola vacía.

## Causas y correcciones

### Tres errores iniciales

Los logs históricos accesibles solo incluyen métricas, sin excepción explícita. Sus tres primeras ejecuciones fueron a las 11:45 de Costa Rica; la clave privada de Supabase se configuró a las 11:50 y la de cifrado a las 11:52. Por tanto esas ejecuciones fueron anteriores a variables requeridas por el código publicado.

El código anterior llamaba `config()` antes de comprobar el interruptor de envío. Una variable ausente o inválida devolvía 503 incluso con envío desactivado, sin registrar el nombre de la variable. Es una causa reproducible y compatible con la cronología; sin excepción histórica no se atribuyen indiscriminadamente todos los errores posteriores a esa misma causa.

Corrección: con envío false, el worker termina correctamente sin red ni reservas. Valida formatos localmente solo para registrar `configuration_validated` o `configuration_warning` con nombre de variable, nunca su valor. Con envío true, una configuración inválida sigue impidiendo enviar. Se agregaron validaciones de URL, switch y Reply-To y logs estructurados de claim/finalización con códigos seguros.

### Botón ausente en el frontend

Confirmado en el repositorio y reproducido por el usuario: `SendTicketEmail` estaba importado pero no se renderizaba en emisión, reemisión ni CSV. Las pruebas de backend y el build anterior no detectaban ese fallo de conexión.

Se conectó el componente en las tres pantallas. En emisión individual se muestra si se indicó correo; en CSV se filtran las filas con correo. Se activó `noUnusedLocals` para que imports desconectados vuelvan a fallar en compilación.

## Validaciones realizadas

- `npm run test:mail`: **9 pruebas correctas**, con proveedor simulado y sin correo real. Incluye modo desactivado aun sin secretos, ausencia de red, diagnóstico seguro, configuración inválida, cifrado, adjunto PNG y resultados aceptado/rechazado/incierto/cancelado.
- `npm run build`: correcto, incluyendo el frontend conectado y comprobación de imports sin uso.
- Suite SQL de cola en el proyecto vinculado, con fixtures y rollback: correcta; no quedaron trabajos ni presupuesto de pruebas. Sin llamadas a Brevo.
- Consulta de metadatos del despliegue y programación: verificada.
- Worker real ejecutado a las 12:23:32 de Costa Rica: logs `worker_disabled` y `configuration_validated` confirmados. Configuración presente y con formatos válidos, sin realizar envíos. Esto no comprueba todavía la autorización de la API key ante Brevo.

## Despliegues realizados

- Diagnósticos del worker: `6aea2607426f42c134ea73d8`, publicado a las 12:21 de Costa Rica.
- Conexión del frontend: `6aea282f2132d16c54be3908`.
- Código del frontend versionado en `4ea009f` y subido a main. Los diagnósticos del backend quedaron versionados previamente en `088c0d1`.
- Prueba real autorizada: `6aea2a16215b0ddfa203ae70`, con envío temporalmente habilitado y límite conservador de 1 intento.
- Estado final restaurado: `6aea2a90dfe68967e6792745`, publicado y ready; `MAIL_SENDING_ENABLED=false` y `EMAIL_DAILY_LIMIT=80`, verificados por API. Se modificaron únicamente esas dos variables no secretas para la prueba y su restauración; ninguna clave, DNS ni configuración de Microsoft fue alterada.

Para volver a desplegar el checkout validado, manteniendo el interruptor false:

```powershell
npm run test:mail
npm run build
npx netlify-cli deploy --prod --build
```

## Resultado de la validación real

El usuario autorizó expresamente activar temporalmente un único correo al buzón de prueba bajo su control. Antes de la activación se comprobó que había exactamente un trabajo pendiente y ninguno en procesamiento. No se usaron destinatarios reales de eventos.

- Alta en cola desde producción: confirmada por el usuario y por consulta de Supabase.
- Worker desplegado: aceptación por Brevo a las 12:39:18 de Costa Rica, estado `submitted`, `attempts=1`, provider_id registrado y sin error.
- Recepción del correo y adjunto PNG: confirmadas por el usuario.
- PNG leído desde el escáner: primera lectura autorizada, segunda duplicada, confirmadas por el usuario.
- Límite temporal de prueba restaurado a 80 y envío devuelto a false mediante un despliegue nuevo; no se autoriza operación general por haber aprobado esta prueba.
- No se reintentaron automáticamente resultados inciertos ni se tocaron entradas de otros asistentes.

## Procedimiento para futuras activaciones controladas

1. Ejecución del nuevo worker confirmada: `worker_disabled` y `configuration_validated`.
2. Emitir/reemitir una entrada sin usar con correo controlado por el usuario y ponerla en cola. Confirmar estado Pending en UI y base de datos.
3. Verificar que **no haya trabajos pendientes de destinatarios reales de eventos** antes de la prueba. La cola no debe usarse para enviar a terceros durante la validación.
4. Solicitar autorización explícita para activar temporalmente el envío al único destinatario de prueba. Hasta recibirla, conservar false.
5. Tras la autorización, ejecutar un envío, comprobar `submitted` y provider_id en Supabase, recepción en el buzón, adjunto PNG, lectura y canje único. `submitted` solo significa aceptación por Brevo, no entrega en bandeja.
6. Volver a false durante la revisión si todavía no se autorizó la operación normal. No reintentar automáticamente resultados inciertos.

La integración queda validada para este recorrido. Antes de habilitar operación normal, obtener autorización para ese modo y revisar los pendientes que vayan a procesarse. No hay confirmación automática de entrega/bounce por webhook; `submitted` sigue significando aceptación de Brevo. El sitio conserva su protección de acceso de Netlify, que debe contemplarse al dar acceso al equipo de puerta.

Fuentes oficiales consultadas: [programación y límites de Scheduled Functions](https://docs.netlify.com/build/functions/scheduled-functions/) y [API transaccional de Brevo](https://developers.brevo.com/reference/send-transac-email).
