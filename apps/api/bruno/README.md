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

## Open in the GUI

1. Launch Bruno.
2. `Collection -> Open Collection` and pick `apps/api/bruno`.
3. Select the `local` environment (top-right dropdown).
4. Click the environment's edit icon and paste values for the three secret vars (one-time; Bruno stores them locally, not on disk):
   - `apiKey` - value of `BRIDGE_API_KEY` from `.env`
   - `adminKey` - value of `ADMIN_API_KEY` from `.env`
   - `fmcsaWebKey` - value of `FMCSA_WEB_KEY` from `.env`

Non-secret vars (`baseUrl`, `loadId`, `mcNumber`, `callId`, `dotSchneider`, `dotSwift`, `mcSchneider`) are pre-populated in [`environments/local.bru`](environments/local.bru).

## Run from the CLI

From this directory (`apps/api/bruno`):

```sh
set -a && source ../../../.env && set +a
bru run --env local \
  --env-var apiKey=$BRIDGE_API_KEY \
  --env-var adminKey=$ADMIN_API_KEY \
  --env-var fmcsaWebKey=$FMCSA_WEB_KEY
```

Run a single folder or file:

```sh
bru run Health --env local
bru run Loads/get-load.bru --env local --env-var apiKey=$BRIDGE_API_KEY
```

## Chained request

`Loads/Search loads (all)` has a post-response script that stashes the first returned `load_id` into the `firstLoadId` collection var. `Loads/Get first load from search` then uses that var. Run them in that order in the same session.

## Keeping in sync with `requests.http`

When you add or change a request in [`apps/api/requests.http`](../requests.http), mirror it here (or vice versa). There's no automation - the two files drift if you're not careful.
