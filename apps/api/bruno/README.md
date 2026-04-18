# Carrier Sales API - Bruno collection

A Bruno collection that mirrors [`apps/api/requests.http`](../requests.http), for folks who prefer Bruno over the VS Code REST Client or JetBrains HTTP Client.

The `.http` file is kept in parallel; the two collections are maintained manually.

## Install Bruno

GUI:

```sh
brew install --cask bruno
```

CLI (optional, for terminal / CI runs):

```sh
npm install -g @usebruno/cli
```

## Start the API

From the repo root:

```sh
pnpm --filter @carrier-sales/api dev   # http://localhost:3111
```

## Environments

Two environments ship with the collection. Switch between them with the top-right dropdown in the GUI, or with `--env <name>` on the CLI.

| Env | `baseUrl` | When to use |
| --- | --- | --- |
| `local` | `http://localhost:3111` | API running via `pnpm --filter @carrier-sales/api dev` |
| `prod` | `https://api.gggfox.com` | Deployed Dokploy instance |

Non-secret vars (`baseUrl`, `loadId`, `mcNumber`, `callId`, `dotSchneider`, `dotSwift`, `mcSchneider`) are pre-populated in [`environments/local.bru`](environments/local.bru) and [`environments/prod.bru`](environments/prod.bru).

Secret vars (`apiKey`, `adminKey`, `fmcsaWebKey`) are **per-environment** in Bruno - paste them once for each env and Bruno stores them locally (not on disk, not in git).

## Open in the GUI

1. Launch Bruno.
2. `Collection -> Open Collection` and pick `apps/api/bruno`.
3. Pick the environment you want in the top-right dropdown.
4. Click the environment's edit icon and paste secret values:
   - For `local`: `apiKey` = `BRIDGE_API_KEY` from root `.env`, `adminKey` = `ADMIN_API_KEY`, `fmcsaWebKey` = `FMCSA_WEB_KEY`.
   - For `prod`: the same three var names, but paste the **production** values (from Dokploy's env, not your local `.env`).
5. Flip the dropdown between `local` and `prod` to re-run the same request against either target.

## Run from the CLI

From this directory (`apps/api/bruno`):

Local:

```sh
set -a && source ../../../.env && set +a
bru run --env local \
  --env-var apiKey=$BRIDGE_API_KEY \
  --env-var adminKey=$ADMIN_API_KEY \
  --env-var fmcsaWebKey=$FMCSA_WEB_KEY
```

Prod (pull the secrets from wherever you keep the prod values - e.g. a local `.env.prod` or your password manager; never commit them):

```sh
set -a && source ../../../.env.prod && set +a
bru run --env prod \
  --env-var apiKey=$BRIDGE_API_KEY \
  --env-var adminKey=$ADMIN_API_KEY \
  --env-var fmcsaWebKey=$FMCSA_WEB_KEY
```

Run a single folder or file against either env:

```sh
bru run Health --env local
bru run Health --env prod
bru run Loads/get-load.bru --env prod --env-var apiKey=$BRIDGE_API_KEY
```

## Chained request

`Loads/Search loads (all)` has a post-response script that stashes the first returned `load_id` into the `firstLoadId` collection var. `Loads/Get first load from search` then uses that var. Run them in that order in the same session.

## Keeping in sync with `requests.http`

When you add or change a request in [`apps/api/requests.http`](../requests.http), mirror it here (or vice versa). There's no automation - the two files drift if you're not careful.
