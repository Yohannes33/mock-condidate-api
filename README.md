# mock-condidate-api

Mock Frappe candidates API for local development and integration testing. Serves the same `receive_candidate` contract so a consuming project (or external ATS / recruitment system) can swap its real Frappe backend for this mock without code changes.

---

## ⚡ Quickstart (Under 2 Minutes)

### 1. Prerequisites (Install Bun)
This project runs on [Bun](https://bun.com) (>= 1.3.0). If you don't have Bun installed:

- **macOS / Linux**:
  ```bash
  curl -fsSL https://bun.sh/install | bash
  ```
- **Windows (PowerShell)**:
  ```powershell
  powershell -c "irm bun.sh/install.ps1|iex"
  ```
- **Via Homebrew / npm**:
  ```bash
  brew install oven-sh/bun/bun
  # or
  npm install -g bun
  ```

Verify installation:
```bash
bun --version
```

### 2. Install Dependencies
```bash
bun install
```

### 3. Configure Environment
Copy the example environment file:
```bash
cp .env.example .env
```
*(By default, `.env.example` is pre-configured to run out-of-the-box in standalone mode or pointing to a local Frappe instance on port 8000).*

### 4. Start the Server
```bash
bun run dev      # hot-reloading dev server
# or
bun start        # standard start
```

### 5. Verify & Test
Open your browser at:
👉 **[http://localhost:8001](http://localhost:8001)**

You will see the built-in interactive Web UI where you can create candidates, test place resolution, view live store data, trigger reservations, and reset test data!

You can also check the health endpoint:
```bash
curl http://localhost:8001/health
# {"ok":true}
```

---

## ⚙️ Configuration (`.env`)

Edit `.env` to switch between **Standalone Mode** (no external Frappe backend needed) and **Connected Mode** (hooked up to local or staging Frappe).

| Variable | Default / Example | Purpose | If Unset |
|---|---|---|---|
| `PORT` | `8001` | Port the mock HTTP server listens on | Defaults to `8001` |
| `WEBHOOK_URL` | `http://localhost:8000/api/method/...` | Outbound URL to POST candidate data upon creation | Mock runs in **Standalone Mode** (inert, no outbound calls) |
| `FRAPPE_BASE_URL` | `http://localhost:8000` | Frappe origin for outbound RPCs (`request_reservation`) | Inferred from `WEBHOOK_URL`'s origin |
| `API_KEY` | `api_key:api_secret` | Frappe user API token sent as `Authorization: token <key>` | Outbound calls sent without auth header |
| `GOOGLE_API_KEY` | `AIzaSy...` | Google Places API key to resolve landmark text to lat/lng | Safe fallback: returns null coordinates without failing |
| `EXTERNAL_RESERVATION_TOKEN` | `mock-reservation-secret` | Shared secret Frappe sends on `PUT /api/external/reservation` | Auth check on callback is bypassed (any caller accepted) |
| `AUTO_CONFIRM_RESERVATION` | `false` | Automatically calls Frappe `request_reservation` on approval PUT | `false` — reservation is triggered manually via Web UI or API |

### Common Setup Scenarios

#### Scenario A: Standalone Mock (Zero Backend Required)
Leave `WEBHOOK_URL=` blank in `.env`.
- Ideal for testing UI, intake forms, place resolution, and Candidate CRUD without needing any Frappe instance running.

#### Scenario B: Local Frappe Development
```env
PORT=8001
WEBHOOK_URL=http://localhost:8000/api/method/mmcy_fleet_management.api.dispatch.receive_candidate
FRAPPE_BASE_URL=http://localhost:8000
API_KEY=your_frappe_user_api_key:your_frappe_user_api_secret
EXTERNAL_RESERVATION_TOKEN=mock-reservation-secret
```

#### Scenario C: Remote Staging Frappe
```env
PORT=8001
WEBHOOK_URL=https://hrms-dev.mmcytech.com/api/method/mmcy_fleet_management.api.dispatch.receive_candidate
API_KEY=your_frappe_user_api_key:your_frappe_user_api_secret
EXTERNAL_RESERVATION_TOKEN=mock-reservation-secret
```

---

## 📡 API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Built-in interactive Web UI for testing |
| `GET` | `/health` | Liveness health check (`{"ok": true}`) |
| `POST` | `/api/method/receive_candidate` | Intake candidate (accepts JSON or form-encoded) |
| `GET` | `/api/method/receive_candidate` | Intake candidate via query parameters |
| `GET` | `/api/places/search?q=Edna%20Mall&session=<uuid>` | Live place suggestions for the Web UI (Google Autocomplete, Ethiopia only, weighted toward Addis Ababa). No coordinates. `503` without `GOOGLE_API_KEY`, `502` when Google refuses |
| `GET` | `/api/places/details?place_id=<id>&session=<uuid>` | Coordinates and address for a picked suggestion. `404` if Google has no point for it inside Ethiopia |
| `GET` | `/api/method/frappe.client.get_list?doctype=Candidate` | List all candidates |
| `GET` | `/api/resource/Candidate/:name` | Fetch one candidate by name |
| `PUT` | `/api/external/reservation` | Inbound callback from Frappe when candidate is ready for reservation |
| `POST` | `/api/reservations/:idOrName/request-reservation?direction=Drop-off` | Call Frappe's `request_reservation` for a leg |
| `GET` | `/api/candidates/:idOrName/frappe-status` | Fetch live trips and status rollup from Frappe |
| `GET` | `/api/settings/recruiter` | Fetch configured recruiter name and email |
| `POST` | `/api/settings/recruiter` | Set recruiter name and email for candidate webhooks |
| `POST` | `/api/reset` | Wipe store and reseed with default candidates |
| `OPTIONS`| `*` | CORS preflight handler (all origins allowed) |

---

## 📝 `receive_candidate` Contract

### Request Payload

Send via `application/json` or `application/x-www-form-urlencoded`:

```json
{
  "candidate_name": "Alice Smith",
  "dropoff_location": "Near Edna Mall, Bole",
  "pickup_location": "Bole Medhanialem",
  "requested_directions": "Both",
  "phone": "+251911234567",
  "id": "REQ-9001",
  "priority": false
}
```

### Fields Specification

| Field | Type | Required? | Details |
|---|---|---|---|
| `candidate_name` | `string` | **Yes** | Candidate's full name |
| `dropoff_location` | `string` | **Yes** | Raw landmark text for drop-off. Gets resolved to Place coordinates if `GOOGLE_API_KEY` is present |
| `pickup_location` | `string` | Optional | Raw landmark text for pick-up. Allowed when `requested_directions` is `"Pick-up"` or `"Both"`. If omitted, Frappe uses the drop-off location |
| `requested_directions`| `string` | Optional | `"Drop-off"`, `"Pick-up"`, or `"Both"`. Defaults to `"Drop-off"` |
| `id` | `string` | Optional | Caller-provided idempotency key. If omitted, mock generates `REQ-<n>` (e.g. `REQ-1004`) |
| `phone` | `string` | Optional | Contact phone number |
| `priority` | `boolean` | Optional | High priority flag (defaults to `false`) |
| `dropoff_place` | `object` | Optional | A place already picked through `/api/places/search` + `/api/places/details` (`place_id`, `display_name`, `formatted_address`, numeric `lat`/`lng`). Used as-is instead of re-searching `dropoff_location`. JSON bodies only |
| `pickup_place` | `object` | Optional | Same as `dropoff_place`, for `pickup_location`. Only accepted alongside `pickup_location` |

> ⚠️ **Validation Note**: Unknown fields are rejected with `400 ValidationError`. Also, providing a `pickup_location` when `requested_directions` is `"Drop-off"` will trigger a validation error.

### 201 Response

```json
{
  "name": "Alice Smith",
  "candidate_name": "Alice Smith",
  "id": "REQ-9001",
  "phone": "+251911234567",
  "dropoff_location": "Near Edna Mall, Bole",
  "dropoff_place": {
    "place_id": "ChIJ...",
    "display_name": "Edna Mall",
    "formatted_address": "Bole, Addis Ababa, Ethiopia",
    "lat": 9.0054,
    "lng": 38.789
  },
  "pickup_location": "Bole Medhanialem",
  "pickup_place": {
    "place_id": "ChIJ...",
    "display_name": "Medhanialem",
    "formatted_address": "Bole, Addis Ababa, Ethiopia",
    "lat": 9.0012,
    "lng": 38.782
  },
  "requested_directions": "Both",
  "priority": false,
  "reservations": [],
  "frappe_candidate": null,
  "created_at": "2026-10-22T10:30:00.000Z"
}
```

---

## 🔗 Frappe Integration (`mmcy_fleet_management`)

When connecting this mock to a real Frappe instance:

1. **In Frappe (`sites/<your-site>/site_config.json`)**:
   Add the callback configuration so Frappe notifies the mock when matches are approved:
   ```json
   {
     "external_reservation_url": "http://localhost:8001/api/external/reservation",
     "external_reservation_token": "mock-reservation-secret"
   }
   ```
2. **Restart Frappe / bench** to reload `site_config.json`.
3. In this mock's `.env`, provide:
   - `WEBHOOK_URL`: `http://localhost:8000/api/method/mmcy_fleet_management.api.dispatch.receive_candidate`
   - `API_KEY`: user API key and secret generated in Frappe desk (e.g. `Administrator`).

---

## 🧪 Testing with `curl`

### Create a Drop-off Candidate:
```bash
curl -X POST http://localhost:8001/api/method/receive_candidate \
  -H "Content-Type: application/json" \
  -d '{
    "candidate_name": "John Doe",
    "dropoff_location": "Edna Mall, Bole",
    "phone": "+251911000000"
  }'
```

### Create a Two-Leg Candidate (Both Directions):
```bash
curl -X POST http://localhost:8001/api/method/receive_candidate \
  -H "Content-Type: application/json" \
  -d '{
    "candidate_name": "Sarah Connor",
    "dropoff_location": "Edna Mall, Bole",
    "pickup_location": "Piassa, Arada",
    "requested_directions": "Both",
    "priority": true
  }'
```

### Reset Candidates:
```bash
curl -X POST http://localhost:8001/api/reset
```

---

## 💾 Storage & Data

- Candidate data is stored in `data/candidates.json` (gitignored).
- On initial startup, the store auto-seeds with 3 pre-configured sample candidates (Edna Mall, Piassa, and Sarbet).
- Recruiter contact info for webhooks is saved in `data/settings.json`.
- Hit **Reset Data** in the UI or call `POST /api/reset` to wipe local changes and revert to seeds.
