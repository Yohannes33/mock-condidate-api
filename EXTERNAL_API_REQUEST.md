# Candidate intake — what we need on the initial POST

Hi <name>,

Ahead of wiring your system up to our fleet/dispatch service, here's the contract for
the first call — the one that creates a candidate on our side. I've split it into what
we hard-require, what we strongly recommend, and what's optional but affects matching
quality.

## Endpoint

```
POST https://<our-site>/api/method/mmcy_fleet_management.api.dispatch.receive_candidate
Content-Type: application/x-www-form-urlencoded
Authorization: token <api_key>:<api_secret>
```

We'll issue you the `api_key:api_secret` pair. The endpoint is not callable
unauthenticated. JSON bodies work too if that's easier on your side.

## Required

| Field | Type | Notes |
|---|---|---|
| `candidate_name` | string | non-empty |
| `dropoff_landmark_raw` | string | the drop-off landmark **exactly as your recruiter typed it**, unmodified |

## Strongly recommended — please treat as required

| Field | Type | Notes |
|---|---|---|
| `external_request_id` | string | Your stable ID for the request. This is our idempotency key: a replay with the same value returns the existing candidate instead of creating a duplicate. It's also the identifier we send back to you on the reservation callback, and the one you'll use to request a reservation later. Without it, retries create duplicates and the rest of the flow has nothing to key on. |

## Optional

| Field | Type | Constraint |
|---|---|---|
| `phone` | string | |
| `starting_date` | string | `YYYY-MM-DD` — intended onboarding date |
| `dropoff_place_place_id` | string | Google Places ID |
| `dropoff_place_display_name` | string | |
| `dropoff_place_formatted_address` | string | |
| `dropoff_place_lat` | number | −90..90 |
| `dropoff_place_lng` | number | −180..180 |
| `priority` | boolean | `true`/`1`/`yes`/`on`; unset means false |
| `recruiter_name` | string | |
| `recruiter_email` | string | must be a valid email if sent |

## Two things worth calling out

**Please send the `dropoff_place_*` fields if you can.** They're optional to pass
validation, but we match candidates to routes geographically — without coordinates
we store the landmark as text only and can't match on distance. If you're already
resolving landmarks through Google Places, forwarding those five fields costs you
nothing and materially improves match quality. If you're not, let us know and we'll
work out where resolution should live.

**Keep the raw landmark text consistent.** We deduplicate locations by normalising
`dropoff_landmark_raw` (lowercase, collapsed whitespace) and reusing the matching
record. So "Near Edna Mall, Bole" and "Edna Mall Bole" become two separate
locations for the same physical place. Consistent phrasing — ideally the Google
Places display name when you have one — keeps that clean.

## Responses

- `200` → `{"message": "<candidate id>"}`. Please persist that id; we reference it in
  later callbacks.
- `403` → auth problem (bad key, or the key lacks permission on our side — tell us).
- Validation failure → a generic `Invalid payload`. Fair warning: our current
  implementation logs the specific per-field errors server-side but doesn't return
  them, so you won't see which field was wrong. Ping us with the
  `external_request_id` and we'll read it out of our logs. We can look at returning
  the detail if it becomes a nuisance during integration.

One more note: we ignore unrecognised fields rather than rejecting them, so a
mistyped field name will fail silently rather than error. Worth a careful check on
first integration.

## Sandbox

We have a mock of your side running the same contract, so we can test the full
round-trip before you're ready — happy to point it at a staging instance whenever
that's useful.

There are two follow-up calls after this one (we notify you when a candidate is
approved and ready for reservation; you call us back to request the reservation).
I'll send that contract separately — it's independent of getting this first call
working, and the callback shape isn't fully locked on our end yet.

Anything here that doesn't fit how your system is structured, say so and we'll
adjust.

Thanks,
Kidus
