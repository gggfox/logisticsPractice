# Deploying to Dokploy on a Hostinger VPS

This guide walks through deploying the **API** and **Dashboard** to a [Hostinger](https://www.hostinger.com/) VPS running [Dokploy](https://dokploy.com/). It assumes Dokploy is already installed and reachable at `https://<your-dokploy-host>`.

If you need to install Dokploy from scratch, follow the official one-liner on a fresh Ubuntu 22.04+ VPS:

```bash
curl -sSL https://dokploy.com/install.sh | sh
```

Then open `http://<vps-ip>:3000` and complete the first-run wizard to create the admin account.

---

## 1. Prerequisites

- A Hostinger VPS with a public IP and at least 2 vCPU / 4 GB RAM.
- Dokploy installed and logged in.
- A domain (or two subdomains) pointed to the VPS:
  - `api.<yourdomain>` -> VPS IP (A record)
  - `dashboard.<yourdomain>` -> VPS IP (A record)
- A Convex project with its deployment URL (`https://<project>.convex.cloud`).
- A GitHub integration configured in Dokploy (`Settings -> Git Providers -> GitHub App`), authorized against this repository.

## 2. Create a Project

In the Dokploy UI:

1. Go to **Projects -> Create Project**.
2. Name it `carrier-sales` (or similar). Both applications below will live inside this project.

## 3. Create the `api` Application

1. Inside the project, click **Create Application**.
2. **Name**: `api`
3. **Source**:
   - Provider: GitHub
   - Repository: this repo
   - Branch: `main`
   - Auto Deploy: **enabled** (so Dokploy rebuilds on every push to `main`)
4. **Build**:
   - Build Type: **Dockerfile**
   - Dockerfile Path: `apps/api/Dockerfile`
   - Build Context: `.` (monorepo root)
5. **Network**:
   - Container Port: `4000`
6. **Environment Variables** (paste into the Env tab):
   ```env
   PORT=4000
   BRIDGE_API_KEY=...
   ADMIN_API_KEY=...
   FMCSA_WEB_KEY=...
   CONVEX_URL=https://<project>.convex.cloud
   WEBHOOK_SECRET=...
   HAPPYROBOT_API_KEY=...
   HAPPYROBOT_BASE_URL=https://api.happyrobot.ai
   ```
7. **Domains**:
   - Host: `api.<yourdomain>`
   - Path: `/`
   - Container Port: `4000`
   - HTTPS: **enabled** (Let's Encrypt)
8. Click **Deploy**. Watch the build log until the container is healthy (`/api/v1/health` must return 200).

## 4. Create the `dashboard` Application

1. From the same project, click **Create Application**.
2. **Name**: `dashboard`
3. **Source**: same repo, branch `main`, Auto Deploy **enabled**.
4. **Build**:
   - Build Type: **Dockerfile**
   - Dockerfile Path: `apps/dashboard/Dockerfile`
   - Build Context: `.`
5. **Build Args** (baked into the Vite bundle at build time):
   ```env
   VITE_CONVEX_URL=https://<project>.convex.cloud
   ```
6. **Network**:
   - Container Port: `80`
7. **Domains**:
   - Host: `dashboard.<yourdomain>`
   - Path: `/`
   - Container Port: `80`
   - HTTPS: **enabled**
8. Click **Deploy**.

> **Note**: `VITE_CONVEX_URL` must be set as a **Build Arg**, not a runtime Env, because Vite inlines `import.meta.env.*` at build time. Changing this value requires a rebuild (click **Redeploy**).

## 5. Verify

After both builds succeed:

```bash
curl -H "x-api-key: $BRIDGE_API_KEY" https://api.<yourdomain>/api/v1/health
# -> {"status":"ok"}
open https://dashboard.<yourdomain>
```

## 6. CI/CD flow

- GitHub push to `main` -> Dokploy GitHub webhook -> both apps rebuild and redeploy in parallel.
- GitHub Actions also runs [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) (lint, typecheck, unit, e2e, build) on every push and PR.
- [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) waits for Dokploy, then performs a post-deploy health check against `vars.API_URL`. Configure:
  - Repo **variable** `API_URL` = `https://api.<yourdomain>`
  - Repo **secret** `BRIDGE_API_KEY` = the same value used in Dokploy

## 7. Secrets & rotations

All runtime secrets live in Dokploy's per-application Env tab. To rotate:

1. Update the value in Dokploy -> **Redeploy** the affected application.
2. Update any mirrored copy in GitHub Actions secrets (`BRIDGE_API_KEY` for the health check).
3. Update the HappyRobot workflow's outbound API key headers to match.

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Dashboard loads but Convex queries fail | `VITE_CONVEX_URL` not set as Build Arg | Set it under Build Args and click **Redeploy** (not just Restart) |
| API container restarts in a loop | Missing required env var | Check `apps/api` logs; compare against `.env.example` |
| HTTPS cert not issued | DNS not propagated or port 80/443 blocked | Confirm A records and that Hostinger firewall allows 80/443 |
| Push to `main` didn't trigger a build | GitHub App not installed on the repo | Reinstall the Dokploy GitHub App against this repo |
