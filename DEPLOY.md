# Despliegue de TrackALead a producción (`panel.trackalead.app`)

App: **React + Vite (SPA)** servida como estático. Backend: **Supabase** (Auth, Postgres, Storage, Edge Functions). Hosting recomendado: **Vercel**.

---

## 1. Variables de entorno

### 1.1 Cliente (Vercel → Project Settings → Environment Variables)
Solo claves **públicas** (las `VITE_*` viajan en el bundle del navegador):

| Variable | Dónde obtenerla |
|---|---|
| `VITE_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → `anon` `public` key |
| `VITE_GOOGLE_MAPS_API_KEY` | Google Cloud → APIs & Services → Credentials (restringe por dominio) |

> ⚠️ **Nunca** pongas aquí el `service_role` key ni claves de IA.

### 1.2 Edge Functions (Supabase → Edge Functions → Secrets)
| Secret | Notas |
|---|---|
| `AI_KEYS_KEK` | Frase larga y aleatoria para cifrar las API keys de IA (AES-GCM). **Rótala a un valor fuerte antes de producción.** Si la cambias después, las keys ya guardadas dejan de descifrarse. |
| `SUPABASE_URL` | Inyectada automáticamente por Supabase. |
| `SUPABASE_SERVICE_ROLE_KEY` | Inyectada automáticamente por Supabase. |

Generar una KEK fuerte:
```bash
openssl rand -base64 48
```
```bash
npx supabase secrets set AI_KEYS_KEK="<valor-generado>" --project-ref TU_PROJECT_REF
```

---

## 2. Pasos en Vercel

1. **Importar el repo** `github.com/Luis29MP/trackalead` en Vercel.
2. Framework: **Vite** (autodetectado). Build: `npm run build`. Output: `dist`. (Ya definido en `vercel.json`.)
3. Añadir las **variables del punto 1.1** (Production, Preview y Development).
4. **Deploy**. El `vercel.json` incluye los *rewrites* SPA (todas las rutas → `index.html`) para que React Router funcione en recarga/deep-links.

---

## 3. Dominio `panel.trackalead.app`

1. Vercel → Project → **Settings → Domains** → añade `panel.trackalead.app`.
2. En tu DNS, crea el registro que indique Vercel (normalmente **CNAME** `panel` → `cname.vercel-dns.com`).
3. Espera la verificación y el SSL automático.

---

## 4. Configuración de Supabase para el dominio

1. **Auth → URL Configuration**:
   - *Site URL*: `https://panel.trackalead.app`
   - *Redirect URLs*: añade `https://panel.trackalead.app/**` (quita los `localhost` en producción).
2. **Auth → Providers → Email**: activa **Leaked password protection** (hoy desactivada).
3. **Edge Functions**: confirma desplegadas (`ai-proxy`, `save-api-key`, `summarize-lead`):
   ```bash
   npx supabase functions deploy ai-proxy       --project-ref TU_PROJECT_REF --no-verify-jwt
   npx supabase functions deploy save-api-key   --project-ref TU_PROJECT_REF --no-verify-jwt
   npx supabase functions deploy summarize-lead --project-ref TU_PROJECT_REF --no-verify-jwt
   ```
4. **Google Maps**: en Google Cloud, restringe la API key a `panel.trackalead.app/*`.

---

## 5. Checklist previo a producción

- [ ] Variables `VITE_*` configuradas en Vercel.
- [ ] `AI_KEYS_KEK` rotado a valor fuerte (antes de guardar keys reales).
- [ ] Dominio `panel.trackalead.app` verificado con SSL.
- [ ] Supabase Auth: Site URL + Redirect URLs del dominio; localhost retirado.
- [ ] Leaked password protection activada.
- [ ] Edge Functions desplegadas.
- [ ] Google Maps key restringida por dominio.
- [x] **RLS activado** en las 18 tablas públicas (ver punto 6).
- [ ] `.env.local` **NO** subido al repo (ya está en `.gitignore`).

---

## 6. ✅ Seguridad: Row Level Security (RLS)

**RLS está activado** en las 18 tablas públicas con aislamiento por organización
(`boards, board_columns, leads, lead_files, lead_comments, lead_activity, calendar_events,
notifications, budgets, budget_partidas, professionals, pro_knowledge, organizations,
org_members, profiles, invitations, plan_config, error_logs`). El `anon key` ya no permite
leer/escribir datos de otras organizaciones.

**Arquitectura de los flujos sin sesión:** el panel del profesional (`/pro/:token`), los
enlaces públicos de lead (`/p/:token`), las invitaciones (`/invite/:token`) y el alta por
enlace (`/join/:orgId`) **no** usan acceso directo a tablas (RLS lo bloquearía con el `anon
key`). Validan el token en el servidor mediante funciones `SECURITY DEFINER` (RPCs:
`pro_load`, `pro_partida_save`, `pro_lead_comment`, `pro_lead_comments`, `pro_lead_file`,
`pro_budget_create`, `pro_rates_save`, `pro_knowledge_*`, `public_lead_by_token`,
`invitation_by_token`, `accept_invitation`, `org_name_by_id`).

**Panel SuperAdmin (SAT) y modo fantasma:** las políticas `is_super_admin()` dan al rol
super admin lectura cross-org (y escritura sobre `organizations`/`profiles`/`plan_config`)
para que el panel SAT y la visualización fantasma sigan funcionando con RLS activo.

**Pendiente manual (no bloqueante de RLS):**
- Activar *Leaked password protection* en Supabase Auth.
- Los buckets públicos (`lead-files`, `pro-knowledge`, `budgets`, `lead-attachments`)
  permiten listar objetos por su política `SELECT` amplia; si se quiere ocultar el listado,
  restringir esas políticas (el acceso por URL pública del objeto seguiría funcionando).
