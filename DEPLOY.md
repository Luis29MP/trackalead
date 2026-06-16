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
- [ ] **RLS activado** en las tablas públicas (ver más abajo — pendiente).
- [ ] `.env.local` **NO** subido al repo (ya está en `.gitignore`).

---

## 6. ⚠️ Pendiente de seguridad antes de abrir al público: RLS

Actualmente **18 tablas tienen Row Level Security desactivado**. Como el `anon key` viaja en el bundle, hoy cualquiera podría leer/escribir datos de todas las organizaciones vía la API de Supabase.

**No abrir a clientes reales hasta activar RLS** con aislamiento por organización. Implica además adaptar los flujos sin sesión (panel del profesional `/pro/:token`, enlaces públicos `/p/:token`, invitaciones) a Edge Functions con `service_role`, porque RLS estricto bloquea el acceso anónimo. (Tarea planificada aparte.)
