# Membresía básica y personal por evento

Las migraciones 004 y 005 agregan el rol de organización `member` y la RPC `provision_event_member`.

- Un miembro básico no es administrador de organización. Solo ve los eventos que tenga asignados.
- Un administrador de organización puede incorporar una cuenta Auth existente, creada por invitación, y asignarle admin/supervisor/scanner en su evento.
- La membresía básica y la asignación se guardan en una transacción con auditoría. Un error revierte ambas.
- Las membresías owner/admin existentes se conservan. No se degradan automáticamente: revisarlas individualmente antes de usar cuentas actuales como personal restringido.
- `add_organization_member` sigue siendo exclusiva del propietario, ahora usa `member` por defecto y no permite degradar propietarios.
- No cambian las políticas RLS existentes: ya distinguen administración de organización y asignaciones por evento.

## Aplicación

Aplicar las migraciones mediante el procedimiento Supabase CLI que usa el proyecto, primero en staging/local. Revisar qué migraciones están pendientes antes de subirlas. Si ejecutás SQL manualmente, ejecutar **004 y 005 por separado y en ese orden**, esperando el commit de 004 antes de 005: PostgreSQL no permite usar un valor enum nuevo antes de confirmar su transacción.

1. `supabase/migrations/202611020004_basic_org_role.sql`
2. `supabase/migrations/202611020005_basic_member_provisioning.sql`

Las migraciones 004 y 005 se aplicaron al proyecto remoto `santos-rock-access` el 2 de noviembre de 2026 mediante Supabase CLI, tras comprobar con dry-run que solo estaban pendientes esas dos migraciones. La ejecución terminó correctamente. El frontend muestra una explicación si la RPC no está disponible en otro entorno.

## Probar desde la aplicación

1. Invitar una cuenta de prueba desde Authentication → Users. El correo requiere SMTP disponible o esperar a que se libere el límite del servicio predeterminado.
2. Copiar el UUID de la cuenta. No usar contraseñas ni tokens en este formulario.
3. Entrar como propietario/administrador de organización; abrir un evento → Administrar equipo → Incorporar una cuenta invitada.
4. Pegar el UUID y elegir Personal de puerta. Verificar que la lista diga Miembro de organización y Personal de puerta.
5. Entrar con la cuenta de prueba en otro perfil de navegador: solo debe ver su evento, sin Crear evento ni Administrar equipo.
6. Asignarle otro rol de evento y comprobar persistencia al recargar.
7. Verificar `organization.member_added` y `event.member_assigned` en auditoría.

## Pruebas de autorización SQL

`supabase/tests/basic_membership.sql` crea fixtures y los revierte con rollback. Ejecutar como propietario de base de datos únicamente en local/staging después de 001–005. Comprueba aprovisionamiento, visibilidad de scanner, rechazo de escalamiento y operaciones entre organizaciones, protección del propietario y auditoría. Requiere una base de pruebas sin otras membresías de las cuentas generadas. Estas pruebas aún no se ejecutaron: las migraciones se aplicaron usando Supabase CLI mediante npx, pero no hay un entorno local/staging de PostgreSQL disponible. Estas comprobaciones simulan la identidad en SQL y deben complementarse con las sesiones reales del procedimiento anterior.

Siguiente fase: invitaciones desde un endpoint de servidor autorizado y SMTP. Luego emisión de entradas y canje atómico; el escáner todavía no valida ingresos.
