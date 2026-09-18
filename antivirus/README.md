# Vault scanner

ClamAV with a small HTTP front, in one image. The API posts every uploaded vault zip here
before unpacking it into Sanity, and refuses the upload if it cannot get an answer.

A listing is somebody else's files going out to every buyer who downloads it. The browser's
`.zip` check is a fast no, not evidence about the contents, so the archive is scanned where the
bytes actually are.

```
POST /scan     raw bytes -> {"clean":true} | {"clean":false,"signature":"Eicar-Test-Signature"}
GET  /health   {"ok":true} -- false until clamd has loaded its signatures (about a minute)
```

The body is streamed straight through to clamd, so a 70 MB vault never has to fit in this
process's memory. The caller is `server/src/malware.ts`.

## Deploy it on Render

It has to be a **private service**. `clamd` has no authentication and no TLS, and the vault
bytes cross that socket in the clear — that is sellers' paid content, so it must never be
reachable from the internet.

1. **New → Blueprint**, Blueprint Path `antivirus/render.yaml`. Or create a Private Service by
   hand from this repo with Root Directory `antivirus`.
2. Check two fields before deploying:
   - **Region** — must match the API's, or the private network will not connect them.
   - **Plan** — `1c-2g` minimum. clamd holds its whole signature database in memory, about
     1.1 GB idle. If you see OOM restarts, move up to `2c-4g`.
3. Copy the internal address from the dashboard. Render appends a generated suffix, so it looks
   like `vault-antivirus-a1b2:8080` — not `vault-antivirus`.
4. On the **API** service set:

   ```
   SCANNER_URL=vault-antivirus-a1b2:8080     # http:// is filled in if you leave it off
   SCANNER_TOKEN=<the value Render generated for the scanner>
   ```

5. Redeploy the API. `GET /health` on the API now reports `uploadScan: true`.

That variable is the whole switch. Unset, the API keeps working exactly as before and uploads
are not scanned.

## Check it actually works

`uploadScan: true` only proves the variable is set. Prove the rest with an upload:

```bash
# from a shell that can reach the scanner
printf 'X5O!P%%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*' > eicar.txt
zip -q vault.zip eicar.txt
curl -s -X POST --data-binary @vault.zip \
  -H 'authorization: Bearer <token>' http://<scanner>:8080/scan
# {"clean":false,"signature":"Eicar-Test-Signature"}
```

Uploading that zip as a vault should come back as a 422 naming the signature. Your own
antivirus may object to the file existing — that is rather the point of it.

## Locally

`docker compose up --build` runs it as the `antivirus` service; the api already points at it.
No ports are published for it, by design.

## Settings

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `8080` | HTTP port. Render sets this itself. |
| `SCANNER_TOKEN` | unset | Shared secret. Unset means anything that can reach the port may scan. |
| `MAX_SCAN_BYTES` | `104857600` | Refused past this. The API's own ceiling is 70 MB. |
| `SCAN_TIMEOUT_MS` | `120000` | How long to wait on clamd for one archive. |
| `CLAMD_HOST` / `CLAMD_PORT` | `127.0.0.1` / `3310` | clamd is in this container; you should not need these. |

The three `CLAMD_CONF_*` size limits live in the `Dockerfile`, pinned so a 70 MB vault cannot
be refused by a default that changes underneath us.

## The signature database

It is baked into the `clamav/clamav:1.4` base image, so a fresh container is scanning about a
minute after boot and `freshclam` only fetches daily diffs afterwards. Compose keeps those
updates on the `clamav-db` volume.

On Render there is no volume, so every deploy starts from the image's database and updates from
there — fine, and one less thing to pay for. If you would rather persist it, add a disk at
`/var/lib/clamav` and switch the base image to `clamav/clamav:1.4_base`, which exists for
exactly that case. A disk also disables zero-downtime deploys, which does not matter here.
