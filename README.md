# Santos Rock Access

Aplicación de gestión de eventos, entradas, control de ingreso, finanzas y entrega de QR por correo. React y TypeScript en el frontend; Supabase para autenticación, permisos y base de datos; Netlify Functions y Brevo para correo.

## Estructura

| Carpeta | Responsabilidad |
| --- | --- |
| frontend/ | Interfaz, componentes, estilos y recursos públicos. Los módulos funcionales están en src/features/. |
| backend/ | Lógica de correo y handlers de servidor; variables privadas documentadas en .env.example. |
| netlify/functions/ | Adaptadores del despliegue y programación del worker. Conservan las URLs existentes. |
| supabase/migrations/ | Fuente de verdad del esquema, RPC y políticas de acceso. |
| supabase/tests/ | Comprobaciones SQL de reglas y permisos. |
| tests/ | Pruebas unitarias, backend, interfaz e integración concurrente. |
| scripts/admin/ | Herramientas administrativas de ejecución manual. |
| docs/ | Guías de configuración, funcionalidades, operación e informes. |
| archive/database/ | ZIP históricos de base de datos; no se usan para compilar ni desplegar. |

Los archivos de configuración compartidos permanecen en la raíz. No hay instalaciones npm independientes por carpeta.

## Desarrollo

Requisitos: Node.js compatible con las dependencias del proyecto y npm.

```sh
npm ci
# Copiar .env.example a .env.local y completar las variables públicas de Supabase.
npm run dev -- --port 5173 --strictPort
```

Ejecutar los comandos desde la raíz. Vite sirve frontend/ y sigue leyendo .env.local desde la raíz. Las claves privadas del backend se configuran en Netlify, según backend/.env.example; nunca usar el prefijo VITE_ para secretos.

El servidor Vite ejecuta la interfaz. Para probar correo con funciones locales se necesita Netlify Dev y su configuración de servidor; las pruebas automatizadas de correo usan servicios simulados y no envían mensajes reales.

## Verificación

```sh
npm run build
npm run test:csv
npm run test:mail
npm run test:ui -- --workers=2
```

Las pruebas de interfaz requieren Chrome instalado o un navegador de Playwright. PLAYWRIGHT_EXECUTABLE_PATH permite indicar otro ejecutable. Consultar [pruebas concurrentes](docs/operations/concurrency-testing.md) antes de ejecutar test:concurrency: utiliza una base de datos y crea fixtures temporales.

## Despliegue y base de datos

Netlify conserva npm run build como comando y dist/ como directorio de publicación. Los adaptadores de funciones están en netlify/functions/; el worker mantiene su programación cada 15 minutos. Reorganizar archivos no requiere cambiar variables de entorno ni aplicar migraciones.

Las migraciones SQL se mantienen en supabase/migrations/. Revisar su estado con Supabase CLI antes de aplicar cambios pendientes; no reinicializar una base existente para configurar el frontend. La autorización se valida mediante RLS y RPC; los roles de interfaz no sustituyen esos controles.

Ver el [índice de documentación](docs/README.md) para configuración, flujos y operación.
