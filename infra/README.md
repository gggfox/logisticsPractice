# Infrastructure

This project deploys to a [Hostinger](https://www.hostinger.com/) VPS running [Dokploy](https://dokploy.com/). Dokploy handles builds, container orchestration, Traefik-based routing, and Let's Encrypt certificates, so there is no Terraform module to apply.

See [../docs/dokploy-setup.md](../docs/dokploy-setup.md) for the full step-by-step setup of the API and Dashboard applications.

For running the stack on a developer laptop (Redis + optional SigNoz),
see [dev/README.md](./dev/README.md).

## At a glance

- Provider: Hostinger VPS (Ubuntu 22.04+ recommended)
- Orchestrator: Dokploy (Docker + Traefik)
- Deploy trigger: GitHub push to `main` -> Dokploy webhook -> rebuild & redeploy
- Applications:
  - `api` built from [`apps/api/Dockerfile`](../apps/api/Dockerfile)
  - `dashboard` built from [`apps/dashboard/Dockerfile`](../apps/dashboard/Dockerfile)

## Previous setup

This directory previously held a Terraform module targeting Railway. It has been removed in favor of Dokploy's UI-driven configuration. If you need the old setup, check the repository history.
