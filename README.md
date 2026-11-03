# Santos Rock Access

Frontend inicial: React + TypeScript + Vite + Supabase Auth. Incluye acceso por invitación, configuración de contraseña y dashboard de eventos protegido por sesión y RLS. Ver [configuración del frontend](docs/frontend.md).

```bash
npm install
# Copiar .env.example a .env.local y completar las variables públicas
npm run dev -- --port 5173 --strictPort
```

## Database foundation

## Scope of migration 001

Creates the initial PostgreSQL schema, indexes, role enums, membership predicates and read-only Row Level Security policies. **This is a foundation, not a deployable ticket-validation system.** Ticket issuance, credential generation, check-in, audit writes, organization onboarding, tenant consistency constraints, and controlled mutations will be added in subsequent migrations before production use.

## Requirements

- Supabase project (new, dedicated project recommended)
- Supabase CLI
- Local Docker for `supabase start` (optional, recommended)

## Setup

```bash
npx supabase init
# Copy the migration into supabase/migrations/
npx supabase start
npx supabase db reset
```

For remote deployment, first link the project and inspect migration status:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

Never put the service role key in the browser or Git. Store server-side credentials in your provider's secret manager.

## Important design constraints

- Users are authenticated by Supabase Auth; permissions are derived from database memberships.
- `app_private` predicates use `SECURITY DEFINER` and an empty `search_path`. Do not expose this schema through PostgREST.
- No client write privileges are granted yet; mutations must be exposed through purpose-built, authorized functions.
- Scanner users cannot read the full tickets, orders or personal data tables.
- One accepted check-in per ticket is enforced by a partial unique index.
- Ticket credentials store digests, not raw QR tokens.
- Third-party QR support depends on an approved LaTiqueteraCR integration.

## Before going live

Add: event/organization consistency triggers (including holder membership), safe provisioning and role changes, issuance/redeem RPCs, immutable audit logging, rate limits, privacy/retention policies, integration tests with multiple simultaneous scanners, email delivery and contingency procedures.
