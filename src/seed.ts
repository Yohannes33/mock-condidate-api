import type { Candidate } from "./types.ts";

/**
 * One candidate per intake shape, so the per-leg pipeline is exercised by a plain reset
 * rather than by hand-building a request:
 *
 *  - Abebe   "Drop-off"  -- one leg. The historical shape; proves nothing regressed.
 *  - Sara    "Both"      -- two legs from *different* places. The interesting one.
 *  - Daniel  "Pick-up"   -- one leg, no pickup address, so Frappe falls back to the
 *                           drop-off place. Pins the documented fallback.
 *
 * Sara is the case that matters: her morning collection point is nowhere near her
 * evening destination, which is exactly why a leg owns its own place instead of reading
 * one off the person. A seed set where both legs shared an address would have let a
 * single-place regression through unnoticed.
 */
export const seedCandidates: Candidate[] = [
	{
		name: "Abebe Kebede",
		candidate_name: "Abebe Kebede",
		id: "REQ-1001",
		phone: "+251911000111",
		dropoff_location: "Bole Edna Mall, gate 2",
		dropoff_place: {
			place_id: "ChIJn2qQo3J3XRYRkR3QY3QY3QY",
			display_name: "Edna Mall",
			formatted_address: "Bole, Addis Ababa, Ethiopia",
			lat: 9.0054,
			lng: 38.789,
		},
		pickup_location: null,
		pickup_place: null,
		requested_directions: "Drop-off",
		created_at: "2026-05-30T09:00:00.000Z",
		reservations: [],
		frappe_candidate: null,
		priority: false,
	},
	{
		name: "Sara Tesfaye",
		candidate_name: "Sara Tesfaye",
		id: "REQ-1002",
		phone: "+251922000222",
		dropoff_location: "Piassa, in front of Commercial Bank",
		dropoff_place: {
			place_id: "ChIJPk4sQY3XRYRkR3QY3QY3QY3",
			display_name: "Commercial Bank of Ethiopia - Piassa",
			formatted_address: "Piassa, Addis Ababa, Ethiopia",
			lat: 9.0192,
			lng: 38.7525,
		},
		// Collected in Ayat, dropped in Piassa -- roughly opposite sides of the city.
		pickup_location: "Ayat Square, near the condominium gate",
		pickup_place: {
			place_id: "ChIJAyat3XRYRkR3QY3QY3QY3QA",
			display_name: "Ayat Square",
			formatted_address: "Ayat, Addis Ababa, Ethiopia",
			lat: 9.0208,
			lng: 38.8567,
		},
		requested_directions: "Both",
		created_at: "2026-05-31T14:15:00.000Z",
		reservations: [],
		frappe_candidate: null,
		priority: false,
	},
	{
		name: "Daniel Mekonnen",
		candidate_name: "Daniel Mekonnen",
		id: "REQ-1003",
		phone: null,
		dropoff_location: "Sarbet, near St. Urael Church",
		dropoff_place: {
			place_id: "ChIJU3Rae3XRYRkR3QY3QY3QY3Q",
			display_name: "St. Urael Church",
			formatted_address: "Sarbet, Addis Ababa, Ethiopia",
			lat: 9.0135,
			lng: 38.74,
		},
		// No pickup_location on purpose: Frappe uses the drop-off place for the pick-up
		// leg, which is the confirmed fallback in the intake contract.
		pickup_location: null,
		pickup_place: null,
		requested_directions: "Pick-up",
		created_at: "2026-06-01T08:45:00.000Z",
		reservations: [],
		frappe_candidate: null,
		priority: false,
	},
];
