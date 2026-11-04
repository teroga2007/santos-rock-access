# Frontend — fase 1

Referencia: chat compartido «Diseñar app de acceso». La última fase acordada es autenticación real antes de emisión de entradas y lectura QR.

## Ejecutar localmente

1. `npm install`
2. Copiar `.env.example` a `.env.local`.
3. Completar `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` desde el proyecto Supabase. Usar exclusivamente la clave pública/publishable (o anon), nunca service_role ni secret.
4. `npm run dev -- --port 5173 --strictPort`
5. Abrir `http://127.0.0.1:5173`.

Sin variables se muestra la pantalla de acceso con el formulario deshabilitado. No hay datos demo ni conexión automática al proyecto remoto.

## Supabase Auth

- Mantener deshabilitado el registro público. Invitar usuarios desde el panel de Supabase; no se incluye un endpoint de invitaciones administrativas en esta fase.
- En Authentication → URL Configuration, configurar Site URL y permitir `http://127.0.0.1:5173/auth/accept` durante desarrollo. En producción usar el dominio HTTPS de Netlify o `https://access.santosrock.com/auth/accept` una vez configurado.
- Enviar la invitación con redirección a `/auth/accept` en el origen elegido. Los enlaces implícitos con tokens, los callbacks con `code` y los enlaces personalizados con `token_hash` y `type=invite` o `type=recovery` tienen manejo en la aplicación. Un código PKCE solo puede intercambiarse donde existe su verificador.
- `/auth/accept` requiere una sesión válida y permite configurar contraseña. Luego muestra el dashboard. No reutilizar enlaces de invitación ya consumidos.
- La sesión persiste mediante Supabase JS; el dashboard requiere sesión. Las filas accesibles dependen de RLS y de las membresías de las migraciones 001–003. El texto del rol es informativo y no autoriza operaciones.
- El frontend no modifica perfiles, roles ni tickets. Los propietarios y administradores de organización pueden crear eventos mediante `create_event`; la RPC verifica los permisos y registra auditoría. Los administradores únicamente de evento no reciben esta opción. Las fechas del formulario se interpretan en Costa Rica (UTC−6) y el evento nace como borrador.

## Netlify

El archivo `netlify.toml` configura build y fallback SPA para `/auth/accept`. Agregar ambas variables públicas al entorno de build. Ajustar las URLs de Supabase al dominio definitivo y volver a enviar las invitaciones que apuntaban a localhost:3000. Esta configuración no cambia por sí sola el panel de Supabase.

## Verificación con el proyecto conectado

1. Invitado: aceptar enlace nuevo, definir contraseña y entrar.
2. Recargar: comprobar persistencia de sesión.
3. Salir: comprobar que ya no se ve el dashboard; volver a ingresar con contraseña.
4. Invitación vencida o reutilizada: comprobar el mensaje y solicitar una nueva.
5. Usuario sin membresías: comprobar estado vacío.
6. Propietario: comprobar que aparece el evento de prueba existente y fecha/hora de Costa Rica.
7. Scanner/supervisor de otro evento: comprobar que RLS oculta eventos no asignados. No usar SQL Editor con rol postgres como sustituto de estas pruebas.

Pendientes del backend: emisión y canje atómico, integración aprobada con LaTiqueteraCR, invitaciones administrativas desde servidor y pruebas de permisos con JWT reales. No se presenta un escáner operativo en esta fase.

## Estado al 2 de noviembre de 2026

- El usuario confirmó el ingreso con contraseña después de restablecerla mediante Node. No se ha confirmado el flujo completo por correo; el envío de recuperación alcanzó el límite de Supabase.
- Implementada la creación de eventos desde una sesión autenticada, con organización seleccionable entre membresías propias owner/admin, validación de fechas y actualización de la lista. Compilación verificada.
- Próxima prueba manual: crear un evento como propietario, verificar su aparición como borrador y la acción `event.created` en auditoría. Comprobar persistencia al recargar y cierre de sesión.
- Pendiente comprobar denegación con usuarios de puerta, supervisores y usuarios de otra organización. El ingreso exitoso de una cuenta no demuestra todos los permisos.
- Después: administración de equipo mediante las RPC existentes; invitaciones desde un backend protegido; emisión de entradas; canje y escáner. Configurar SMTP antes de depender del envío regular de invitaciones y recuperación.

## Equipo por evento

El usuario confirmó la creación de eventos con una sesión real. Cada evento ahora incluye «Administrar equipo» para propietarios y administradores de su organización. Permite consultar membresías y asignar o cambiar admin/supervisor/scanner mediante `assign_event_member`; los cambios se autorizan y auditan en la RPC existente. No se realizan escrituras directas a tablas.

Los perfiles de otras personas no son legibles con la política actual: se muestran UUIDs y se identifica la cuenta propia como «Vos». No se incorporan correos ni se consulta Auth Admin desde el navegador.

Las migraciones 004–005 resuelven la limitación original de `org_role` (solo owner/admin) agregando membresía básica y aprovisionamiento por evento. Se deben aplicar antes de usar «Incorporar una cuenta invitada». Las membresías administrativas previas conservan su acceso global. Ver [membresía básica](basic-membership.md) para aplicación y pruebas. No se envían invitaciones ni se eliminan membresías desde el frontend.

Prueba manual pendiente: abrir el equipo como propietario, asignar un miembro existente, comprobar persistencia tras recargar y `event.member_assigned` en auditoría. Confirmar rechazo de la RPC con un usuario sin administración de organización y con un miembro de otra organización. No se han ejecutado cambios de roles en el proyecto remoto desde este agente.

El usuario confirmó que el panel de equipo y la asignación de roles funcionan como esperaba. Siguen pendientes las pruebas de denegación entre roles y organizaciones; la confirmación funcional no sustituye esas comprobaciones.

## Gestión de eventos — prioridad 1

- Listado de los eventos permitidos por RLS, con búsqueda por nombre/lugar, filtro por estado, orden por fecha y contador de resultados. Los filtros operan sobre la lista cargada; todavía no hay paginación de servidor.
- Creación mediante `create_event`, disponible para propietarios y administradores de organización, con validación de fechas e interpretación explícita en Costa Rica.
- Detalle en `/events/:id`, accesible desde «Ver detalles». Consulta el evento por ID y muestra lugar, estado, inicio/cierre, zona horaria, fecha de creación e identificador, más el panel de equipo ya existente. Los enlaces directos conservan la ruta después de iniciar sesión.
- Eventos inexistentes o sin acceso comparten mensaje; los errores de conexión ofrecen reintento. El fallback SPA de Netlify cubre estas rutas.

Validación: compilación TypeScript/Vite correcta. Pendiente revisión visual y funcional con la sesión del usuario: filtrar, abrir detalle, recargar la URL, regresar al listado y crear un evento. Probar también un UUID inválido y un evento de otra organización. La creación y las asignaciones previas ya fueron confirmadas por el usuario; no se crearon eventos remotos adicionales para esta iteración.

El usuario confirmó el funcionamiento de la gestión de eventos. El 3 de noviembre se agregó emisión de entradas propias y acreditaciones mediante la migración 006; ver [emisión de entradas](../features/ticket-issuance.md) para uso, permisos, pruebas y límites. Sigue pendiente probar con cuentas de puerta reales y completar correo/canje.

El usuario confirmó que emitió y guardó su primer QR. Se agregó control de ingreso y gestión del estado operativo del evento en la fase 007; ver [canje y escáner](../features/ticket-redemption.md). No se ha probado todavía con la cámara real del usuario ni se ha canjeado su entrada desde el agente.

El usuario confirmó la primera lectura aprobada con cámara y el rechazo de una segunda lectura mediante código manual. Se agregó el [panel de control por evento](../features/event-dashboard.md), con totales, desglose y últimas lecturas, actualización automática cada 15 segundos y acceso restringido a administración/supervisión.

El usuario confirmó los conteos del panel. Se incorporaron [anulación y reemisión controlada](../features/ticket-actions.md) para entradas sin usar, con motivo, auditoría y reintentos idempotentes. Pendiente prueba funcional de estos botones con el usuario.

El usuario confirmó el funcionamiento de las acciones de entrada. Se agregó [importación CSV de compradores](../features/csv-import.md), con vista previa, lotes atómicos de hasta 100 personas y descarga ZIP de QR. Pendiente prueba funcional con el usuario. El correo y la integración LaTiqueteraCR siguen fuera de esta fase.

El usuario confirmó la importación CSV. Se ejecutaron [pruebas concurrentes de ingreso](../operations/concurrency-testing.md) con 4 operadores ficticios y conexiones SQL independientes: aceptación única de un QR, reintentos idempotentes, carreras con anulación/reemisión y canje de códigos distintos. Todas pasaron y se verificó la limpieza de los fixtures. No equivale a una prueba de carga de 999 asistentes ni de JWT/red/cámara desde dispositivos.

Proveedor de correo elegido: Brevo Free, con cola inicial de 80 intentos diarios. Se prepararon cola cifrada y funciones de Netlify. El usuario todavía no creó Brevo ni los subdominios y pidió continuar esa configuración en otra conversación. Ver [guía de continuidad de correo y despliegue](mail-setup-handoff.md). El envío real permanece desactivado; no se enviaron correos ni se modificaron DNS.
