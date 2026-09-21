# Vault Market for Obsidian

Installs the vaults you bought into your own vault, and updates them in place.

A zip download is a one-time event: the second a seller ships v2, the buyer has to unzip it
somewhere and reconcile it by hand against six months of their own notes, so most never update at
all. This plugin makes an update a normal thing to accept — it writes only the files the seller
actually changed, and never a file you have edited yourself.

## The merge

The plugin records the hash of every file as the seller shipped it (the *base*). On an update it
has three hashes per path: the base, what is on disk now, and what the seller publishes today.

| base vs remote | local vs base | what happens |
| --- | --- | --- |
| same | — | nothing; the seller did not touch it |
| different | same | overwritten — you never edited it |
| different | different | **conflict**: their version is written beside yours as `<name> (v2 from seller).md`, yours is untouched |
| path gone upstream | same | deleted |
| path gone upstream | different | kept, and reported |

Nothing you wrote is ever lost, and nothing is fetched that has not changed: an update to a
400-note vault is one manifest plus the handful of notes that moved.

## Using it

1. Generate a token on the site's Connect page and paste it, with the API URL, into the plugin
   settings.
2. `Vault Market: install or update a vault` (ribbon icon, or the command palette). Pick a vault,
   pick a folder. That folder is where later updates go.
3. `Vault Market: update every installed vault` checks them all.

The token is read-only over the vaults you own — the same one the MCP endpoint takes
(`server/src/token-access.ts`). It cannot buy, publish or delete anything.

## Developing

```bash
npm install
npm run dev     # rebuilds main.js on change
npm run build   # typecheck + bundle
```

To try it in a real vault, copy `manifest.json` and `main.js` into
`<your vault>/.obsidian/plugins/vault-market/` and enable it under Community plugins. The server
side is `server/src/routes/sync.ts`.
