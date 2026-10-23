# Running the Mock Candidate API locally

This guide gets the mock candidate API running on your machine and wired to the
`mmcy_fleet_management` **dev server**, so you can push candidates in, get the
reservation callback back, and watch the whole flow without touching production.

The mock plays the role of the **external recruiter-side system**. Frappe owns
`Candidate`, `Place` and `Route`. Calls go both ways, so the mock must be
reachable *from* the Frappe server as well as able to reach it.

```
mock ──POST receive_candidate──────────▶ Frappe
mock ◀─PUT  /api/external/reservation── Frappe   (on approve_match)
mock ──POST request_reservation────────▶ Frappe
```

---

## 1. Prerequisites

- **Bun ≥ 1.3.0** — <https://bun.sh> (`curl -fsSL https://bun.sh/install | bash`)
- Access to the dev Frappe site (desk login, to generate an API key)
- Optional: a Google Places API key, with the Places API enabled

---

## 2. Get it running standalone

```bash
git clone <repo-url> mock-condidate-api
cd mock-condidate-api
bun install
cp .env.example .env
bun run dev
```

Open <http://localhost:8001> — you get an HTML form for creating candidates by
hand. `GET /health` is the liveness check.

With `WEBHOOK_URL` empty the mock is **fully inert**: it stores candidates
locally and makes no outbound calls at all. That is the fastest way to confirm
the thing runs before you involve Frappe.

---

## 3. Point it at the dev server

Edit `.env`:

```
PORT=8001
WEBHOOK_URL=https://hrms-dev.mmcytech.com/api/method/mmcy_fleet_management.api.dispatch.receive_candidate
FRAPPE_BASE_URL=
API_KEY=<api_key>:<api_secret>
EXTERNAL_RESERVATION_TOKEN=<shared secret>
GOOGLE_API_KEY=<places key>
AUTO_CONFIRM_RESERVATION=false
```

| Var | What it does | If you leave it empty |
|---|---|---|
| `WEBHOOK_URL` | Where each created candidate is POSTed | Mock is inert — no outbound calls |
| `FRAPPE_BASE_URL` | Origin for RPC calls like `request_reservation` | Derived from `WEBHOOK_URL`'s origin — leave empty unless the two genuinely differ |
| `API_KEY` | Sent as `Authorization: token <key>` on every outbound call | Frappe answers `403` — neither endpoint is callable as Guest |
| `EXTERNAL_RESERVATION_TOKEN` | Secret Frappe must present on the inbound callback | Auth check is **disabled**, any caller is accepted. Fine locally, never in a deployment |
| `GOOGLE_API_KEY` | Resolves landmark text → `place_id`, name, address, lat/lng | Places resolve to all-nulls; Frappe stores the landmark as text only and cannot match on distance |
| `AUTO_CONFIRM_RESERVATION` | Auto-fires `request_reservation` on the callback | `false` — you drive it manually, which is what you want while testing |

Restart the server after editing `.env` (`bun run dev` reloads code on save, but
env vars are read at boot).

### Generating the API key

In the Frappe desk on the dev site: **User** → the integration user → *API
Access* → **Generate Keys**. The secret is shown once. The user needs `create`
on `Candidate` and write access for `request_reservation`. Use a dedicated
integration user rather than someone's personal account.

---

## 4. Set up the dev server's site config

The callback leg only works if the Frappe site knows where to call you. On the
dev server, in the bench directory:

```bash
bench --site <site-name> set-config external_reservation_url "http://<your-host>:8001/api/external/reservation"
bench --site <site-name> set-config external_reservation_token "<same shared secret>"
bench restart
```

That writes into `sites/<site-name>/site_config.json`:

```json
{
  "external_reservation_url": "http://<your-host>:8001/api/external/reservation",
  "external_reservation_token": "<same shared secret>"
}
```

Two things to get right:

- **`external_reservation_token` must match `EXTERNAL_RESERVATION_TOKEN`
  exactly.** On a mismatch the mock replies `401` and Frappe rolls the candidate
  back from `Approved` to `Matched`.
- **`external_reservation_url` must be an address the dev server can actually
  reach.** `localhost` only works if the mock runs on that same machine — see
  below.

If `external_reservation_url` is missing entirely, `approve_match` logs
*"External reservation notify skipped"* and the mock is simply never told about
approvals. Everything else still works, so this failure is quiet.

### Making your laptop reachable from the dev server

Since the mock is on your machine and the dev server is not, pick one:

- **Tunnel** (simplest): `cloudflared tunnel --url http://localhost:8001` or
  `ngrok http 8001`, then use the public HTTPS URL it prints as
  `external_reservation_url`. The URL changes each restart, so re-run
  `set-config` each time.
- **VPN / same network**: use your machine's LAN or VPN IP directly.
- **Run the mock on the dev server itself**: then `http://localhost:8001/...`
  is correct as written.

Note that each developer overwrites the same site-wide setting — only one person
receives callbacks at a time. Coordinate before you re-point it.

---

## 5. Smoke test

```bash
curl http://localhost:8001/health
```

Then create a candidate from the form at <http://localhost:8001>, or:

```bash
curl -X POST http://localhost:8001/api/method/receive_candidate \
  -H 'Content-Type: application/json' \
  -d '{"candidate_name":"Alice Smith","dropoff_location":"Near Edna Mall, Bole","phone":"+251911234567"}'
```

Watch the mock's console. A healthy run logs:

```
[webhook] delivered candidate.created for Alice Smith
```

and the stored candidate gains a `frappe_candidate` field holding the name
Frappe returned. Check it with:

```bash
curl http://localhost:8001/api/method/frappe.client.get_list?doctype=Candidate
```

Then in the Frappe desk, approve the match on that candidate. The mock should
receive the `PUT` and record the leg as *Ready for Reservation*. Fire the
reservation yourself with:

```bash
curl -X POST http://localhost:8001/api/reservations/REQ-1004/request-reservation
```

`POST /api/reset` wipes the local store and reseeds when you want a clean slate.

---

## 6. Endpoints at a glance

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/method/receive_candidate` | Create a candidate |
| `GET` | `/api/method/frappe.client.get_list?doctype=Candidate` | List candidates |
| `GET` | `/api/resource/Candidate/:name` | Fetch one candidate |
| `PUT` | `/api/external/reservation` | Inbound: Frappe says a leg is ready |
| `POST` | `/api/reservations/:idOrName/request-reservation` | Manually request a reservation |
| `GET` | `/api/candidates/:id/frappe-status` | Read live status from Frappe |
| `POST` | `/api/reset` | Wipe and reseed |
| `GET` | `/health` | Liveness |

---

## 7. When it doesn't work

| Symptom | Likely cause |
|---|---|
| `[webhook] non-2xx response: 403` | `API_KEY` missing or wrong, or its user lacks `create` on `Candidate` |
| `Invalid payload` / `417` | Frappe validation failed. The per-field detail is **only** in the site's Error Log, never in the response — go read it there |
| Nothing at all in the console | `WEBHOOK_URL` is empty, so the mock is inert |
| Candidate created but no callback ever arrives | `external_reservation_url` unset, or pointing at an address the dev server can't reach |
| Mock logs `401` on the callback | Token mismatch between `site_config.json` and `.env` |
| `refusing to guess which leg it is` | Frappe's PUT arrived without a usable `direction` (`"Drop-off"` or `"Pick-up"`). The mock will not guess, because guessing reserves someone onto the wrong shuttle silently |
| Places all null | `GOOGLE_API_KEY` empty, or the key doesn't have the Places API enabled |

---

## 8. Further reading

- [README.md](README.md) — full endpoint and payload reference
- [INTEGRATION.md](INTEGRATION.md) — the contract against the real Frappe site,
  plus the gaps still open before the mock can be switched off
