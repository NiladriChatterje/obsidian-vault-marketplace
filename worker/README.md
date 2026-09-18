# Upload worker

The consumer end of the vault upload queue. The API (`server/`) no longer has to hold a
seller's 70 MB zip while the scanner works through it; with the queue on, the zip goes from
the browser straight into an S3-compatible store (MinIO in docker-compose), the API writes a
ticket to Redis and answers at once, and this process takes the tickets in turn:

```
browser  --PUT-->  MinIO            (presigned link from POST /uploads/vault-zip/init)
browser  --POST /uploads/vault-zip/complete-->  api  --ticket-->  Redis (BullMQ)
worker   <--ticket--  Redis
worker   --GET-->  MinIO  --POST /scan-->  antivirus  -->  unzip  -->  Sanity  -->  DELETE from MinIO
browser  --GET /uploads/vault-zip/jobs/:id-->  api      (polls until done / failed)
```

The steps are the API's own code, imported from `server/src` (`vault-upload.ts`,
`upload-store.ts`, `upload-queue.ts`), so a zip is accepted or refused for exactly the same
reasons whichever path it took. The Dockerfile's build context is therefore the repo root.

## Running

`docker compose up` starts it beside `redis`, `minio`, `antivirus` and `api`. On its own:

```bash
cd worker
npm install
npm run dev        # reads ../.env
```

Environment (all read from the repo-root `.env`, see `.env.example`):

| Variable | Purpose |
|---|---|
| `QUEUE_REDIS_URL` | Redis the tickets live in. Required. |
| `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` | The store. Required. |
| `MINIO_BUCKET` | Default `vault-uploads`; created on first use, with a one-day sweep on `incoming/`. |
| `SCANNER_URL`, `SCANNER_TOKEN` | The antivirus service; same meaning as for the API. |
| `SANITY_PROJECT_ID`, `SANITY_DATASET`, `SANITY_API_TOKEN` | Where accepted vaults are written. |
| `WORKER_CONCURRENCY` | Zips handled at once, default 2. Each holds up to 70 MB and one scanner thread; size it to the scanner's cores, not this box's. |

## What happens when it fails

- **Scanner not answering, Sanity hiccup** → the ticket is retried, three tries with a growing pause.
- **Malware found, not a zip, empty, over quota, no notes** → failed for good with the same message the inline upload would have given; the object is deleted.
- **Ticket dead after its last try** → the object is deleted. Anything missed is swept by the bucket rule after a day.
- **Worker restarted mid-job** → BullMQ hands the ticket to the next worker once the stall is noticed.

It has no HTTP port. Watch it with `docker compose logs -f worker`.
