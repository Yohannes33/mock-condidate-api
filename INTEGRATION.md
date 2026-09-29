# External System Integration Spec

How to run against the **real** `mmcy_fleet_management` Frappe site instead of this mock.

This mock plays the role of the **external system** (the recruiter-side candidate
source). Frappe (`mmcy_fleet_management`) is the fleet/dispatch system. Everything
below is what the external system must provide, plus the end-to-end flow.

---

## 1. Roles

| Party | Responsibility |
|---|---|
| **External system** (this mock's role) | Owns candidate intake. Resolves the raw landmark text to a Google Place. Pushes each candidate to Frappe. Exposes one inbound endpoint for reservation-ready callbacks. Triggers `request_reservation`. |
| **Frappe** (`mmcy_fleet_management`) | Owns `Candidate`, `Place`, `Route`. Matches candidates to routes, dispatcher approves, seats get reserved. Calls back to the external system on approval. |

Direction of calls:

```
External ──POST receive_candidate──────────────▶ Frappe
External ◀─PUT external_reservation_url──────── Frappe   (on approve_match)
External ──POST request_reservation────────────▶ Frappe
```

---

## 2. What the external system must provide

### 2.1 Outbound — push each candidate

`POST {FRAPPE_BASE_URL}/api/method/mmcy_fleet_management.api.dispatch.receive_candidate`

- `Content-Type: application/x-www-form-urlencoded` (or JSON)
- `Authorization: token <api_key>:<api_secret>`
- **Not callable as Guest** — an authenticated user with `create` permission on
  `Candidate` is required.

| Field | Required | Notes |
|---|---|---|
| `candidate_name` | ✅ | string |
| `starting_date` | ➖ | `YYYY-MM-DD` if sent. Intended onboarding date, used to promote a reservation to an active route member. Made optional Frappe-side in a separate change — so the external system need not collect it. Omitting it means Frappe has no onboarding date for that candidate; confirm how promotion behaves in that case. |
| `dropoff_landmark_raw` | ✅ | raw landmark text as typed by the recruiter |
| `external_request_id` | ⚠️ strongly | idempotency key. Replays return the existing Candidate unchanged. Without it, retries create duplicates. |
| `phone` | ➖ | string |
| `dropoff_place_place_id` | ➖ | from Google Places |
| `dropoff_place_display_name` | ➖ | |
| `dropoff_place_formatted_address` | ➖ | |
| `dropoff_place_lat` | ➖ | numeric, −90..90 |
| `dropoff_place_lng` | ➖ | numeric, −180..180 |
| `priority` | ➖ | `true`/`false`/`1`/`0`/`yes`/`on`; unset = false |
| `recruiter_name` | ➖ | |
| `recruiter_email` | ➖ | must be a valid email if present |

Unknown/extra fields are ignored by Frappe (unlike the mock, which 400s).

**Responses**

- `200` → `{"message": "<Candidate name>"}` — store this name locally; it's the
  handle Frappe uses in later callbacks.
- `417`/`ValidationError` → `Invalid payload`. Frappe deliberately returns a
  **generic** message; the per-field error list is written to the Frappe Error Log,
  not returned. Validate client-side; check the site's Error Log when debugging.
- `403 PermissionError` → bad/missing API key, or the key's user lacks
  `Candidate: create`.

Place handling: Frappe normalizes `dropoff_landmark_raw` (lowercase + collapsed
whitespace) and upserts a `Place` on that key. Same landmark text → same `Place`.
Send consistent raw text or you'll fragment `Place` records.

### 2.2 Inbound — reservation-ready callback

The external system must expose an endpoint Frappe can `PUT` to. In this mock it is
`PUT /api/external/reservation`.

- Frappe sends `Content-Type: application/json`
- `Authorization: token <external_reservation_token>` (only if configured in Frappe)
- 8-second timeout, called from `approve_match`

Payload:

```json
{
  "external_request_id": "REQ-9001",
  "candidate": "CAND-0001",
  "candidate_name": "Alice Smith",
  "matched_route": "ROUTE-0001",
  "state": "Ready for Reservation"
}
```

**Must return 2xx.** A non-2xx or timeout causes Frappe to roll the candidate back
from `Approved` → `Matched` so the dispatcher can re-approve. Ack fast; do any real
work asynchronously.

> The Frappe side notes this endpoint's path/payload/auth shape as *placeholder
> pending the external team's contract*. Confirm it before go-live.

### 2.3 Outbound — request reservation

`POST {FRAPPE_BASE_URL}/api/method/mmcy_fleet_management.api.dispatch.request_reservation`

- form-encoded, `Authorization: token <api_key>:<api_secret>`
- Body: `external_request_id=REQ-9001` (or `name=CAND-0001`)
- Valid only while the candidate is `Approved` (or already `Requested Reservation`,
  which is idempotent). Any other status → `ValidationError`.
- Candidate must have a `matched_route`.

Response:

```json
{
  "candidate": "CAND-0001",
  "status": "Requested Reservation",
  "route": "ROUTE-0001",
  "suggest_route_creation": false
}
```

`suggest_route_creation: true` means the matched route has no free seat — surface
that to the recruiter. This call does **not** reserve the seat;
`Requested Reservation → Reserved` is a separate dispatcher action in Frappe.

---

## 3. Configuration

### On the external system (this project's `.env`)

```
WEBHOOK_URL=https://<frappe-site>/api/method/mmcy_fleet_management.api.dispatch.receive_candidate
FRAPPE_BASE_URL=https://<frappe-site>
API_KEY=<api_key>:<api_secret>
EXTERNAL_RESERVATION_TOKEN=<shared secret, must match Frappe's site_config>
GOOGLE_API_KEY=<places key>
AUTO_CONFIRM_RESERVATION=false
```

`FRAPPE_BASE_URL` is optional — the RPC origin is otherwise derived from
`WEBHOOK_URL`. Set it explicitly when the two differ.

If `EXTERNAL_RESERVATION_TOKEN` is unset, the inbound reservation endpoint accepts
**any** caller. Always set it in a real deployment.

### On the Frappe site (`sites/<site>/site_config.json`)

```json
{
  "external_reservation_url": "https://<external-host>/api/external/reservation",
  "external_reservation_token": "<same shared secret>"
}
```

Restart/reload after editing. If `external_reservation_url` is missing,
`approve_match` logs "External reservation notify skipped" and the external system
is never told about approvals.

### Frappe API credentials

Generate an API key/secret on a Frappe **User** that has `create` on `Candidate`
and write access for `request_reservation`. Use a dedicated integration user, not a
person's account.

---

## 4. End-to-end flow

1. Recruiter submits a candidate to the external system (name, phone, landmark
   text, priority).
2. External system resolves the landmark via Google Places
   (`findplacefromtext`) → `place_id`, `display_name`, `formatted_address`,
   `lat`/`lng`. Failure is non-fatal — send the raw text with empty place fields.
3. External system stores the candidate with a stable `external_request_id`.
4. External system POSTs `receive_candidate`.
5. Frappe validates → upserts `Place` → creates `Candidate` → attempts an inline
   route match. Candidate lands at `Pending` or `Matched`. Returns the Candidate
   name; external system persists it.
6. A dispatcher reviews the match in the Frappe desk and calls `approve_match`.
   `Matched → Approved`, then Frappe PUTs the reservation-ready callback.
7. External system records `Ready for Reservation` (+ `matched_route`) against the
   candidate and 2xx's immediately.
8. Reservation is requested — either automatically
   (`AUTO_CONFIRM_RESERVATION=true`) or manually by the recruiter. External system
   POSTs `request_reservation`. `Approved → Requested Reservation`.
9. Dispatcher reserves the seat in Frappe: `Requested Reservation → Reserved`. On
   `starting_date`, the reservation is promoted to an active route member.

Candidate status ladder in Frappe:

```
Pending → Matched → Approved → Requested Reservation → Reserved
                 ▲         │
                 └─────────┘  rollback if the external callback fails
```

Optional: read a live status with
`GET /api/method/frappe.client.get_value?doctype=Candidate&fieldname=status&filters={"name":"CAND-0001"}`.

---

## 5. Gaps to close before switching off the mock

| Gap | Impact | Fix |
|---|---|---|
| `starting_date` still required on the deployed Frappe site | Every create is rejected with `Invalid payload` until the "make it optional" change is deployed | Nothing to do here — just confirm the target site is running that change before switching over |
| Callback contract is Frappe-side placeholder | Path/payload/auth may change | Confirm with the Frappe team, then align both sides |
| Place cache lookup is deferred | Every create burns a Google Places call | Wire up the Frappe-side place cache endpoint when it ships |
| Webhook is fire-and-forget with no retry | A transient Frappe error silently drops a candidate | Add a retry/outbox; `external_request_id` already makes replays safe |
| Extra fields rejected with 400 locally but ignored by Frappe | Mock is stricter than production | Fine to keep, but don't rely on it as validation |
