export type ResolvedPlace = {
	place_id: string | null;
	display_name: string | null;
	formatted_address: string | null;
	lat: number | null;
	lng: number | null;
};

/**
 * Which legs the candidate is asking for. "Both" is an *intake* flag, not a leg
 * direction -- Frappe expands it into one Pick-up trip and one Drop-off trip.
 *
 * The casing has to match `mmcy_fleet_management/.../directions.py` exactly: "Pick-up",
 * not the "Pick-UP" the backend used to spell it. A mismatch does not throw anywhere --
 * it just silently matches no routes -- so it is worth stating once, here.
 */
export type RequestedDirections = "Drop-off" | "Pick-up" | "Both";

export const REQUESTED_DIRECTIONS: RequestedDirections[] = ["Drop-off", "Pick-up", "Both"];

/** One leg's direction, as Frappe reports it back. Never "Both". */
export type LegDirection = "Drop-off" | "Pick-up";

/**
 * Reservation state is per **leg**, not per person: a candidate can have an approved
 * pick-up and a still-pending drop-off, and each is reserved on its own route. Held as
 * a list keyed by direction for that reason -- a single object could only ever track
 * one of the two.
 */
export type ReservationState = {
	status: "Ready for Reservation" | "Requested" | "Failed";
	direction: LegDirection;
	/** Frappe's Shuttle Trip name. This, not the candidate, is what gets reserved. */
	trip: string | null;
	matched_route: string | null;
	frappe_candidate: string | null;
	notified_at: string;
	requested_at: string | null;
	response: unknown;
};

/** One Shuttle Trip as `get_candidate_trips` returns it. */
export type TripView = {
	name: string;
	direction: LegDirection;
	status: string;
	rejection_reason: string | null;
	place: string | null;
	landmark_raw: string | null;
	matched_route: string | null;
	match_type: string | null;
	match_score: number | null;
	match_distance_km: number | null;
	last_matched_at: string | null;
};

export type Candidate = {
	name: string;
	candidate_name: string;
	id: string | null;
	phone: string | null;
	dropoff_location: string;
	dropoff_place: ResolvedPlace | null;
	/**
	 * Where to collect them for the morning run. Optional even when a pick-up is
	 * requested: Frappe falls back to the drop-off place, which is the confirmed
	 * contract. Only set it when the two genuinely differ.
	 */
	pickup_location: string | null;
	pickup_place: ResolvedPlace | null;
	requested_directions: RequestedDirections;
	created_at: string;
	/** One entry per leg. Replaces the old single-object `reservation` field. */
	reservations: ReservationState[];
	/** Frappe's Candidate.name, learned from the receive_candidate webhook response. */
	frappe_candidate: string | null;
	priority: boolean;
};

export type ReadyForReservationPayload = {
	external_request_id?: string | null;
	candidate?: string | null;
	candidate_name?: string | null;
	/** Frappe sends both so we can tell the legs apart; without them a two-leg
	 * candidate's reservation request is ambiguous and the API refuses it. */
	trip?: string | null;
	direction?: string | null;
	matched_route?: string | null;
	state?: string | null;
};

export type ReceiveCandidateRequest = {
	candidate_name?: string | null;
	phone?: string | null;
	id?: string | null;
	dropoff_location?: string | null;
	pickup_location?: string | null;
	requested_directions?: string | null;
	priority?: boolean | null;
};

export type ErrorResponse = {
	error: string;
	message: string;
};

export type ListResponse = {
	data: Candidate[];
};
