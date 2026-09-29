import { callFrappeMethod } from "./frappe.ts";
import * as store from "./store.ts";
import type {
	Candidate,
	LegDirection,
	ReadyForReservationPayload,
	ReservationState,
} from "./types.ts";

const LEG_DIRECTIONS: LegDirection[] = ["Drop-off", "Pick-up"];

function isLegDirection(value: unknown): value is LegDirection {
	return typeof value === "string" && (LEG_DIRECTIONS as string[]).includes(value);
}

function baseState(direction: LegDirection): ReservationState {
	return {
		status: "Ready for Reservation",
		direction,
		trip: null,
		matched_route: null,
		frappe_candidate: null,
		notified_at: new Date().toISOString(),
		requested_at: null,
		response: null,
	};
}

/** Replaces this direction's entry, leaving the other leg's state untouched. */
function upsertReservation(candidate: Candidate, next: ReservationState): void {
	const rest = (candidate.reservations ?? []).filter((r) => r.direction !== next.direction);
	candidate.reservations = [...rest, next];
}

export function findReservation(
	candidate: Candidate,
	direction: LegDirection,
): ReservationState | undefined {
	return (candidate.reservations ?? []).find((r) => r.direction === direction);
}

/**
 * Handles Frappe's PUT notifying us that one **leg** is ready for reservation.
 *
 * Frappe sends `direction` and `trip` precisely so the two legs can be told apart. The
 * direction is required rather than defaulted: guessing "Drop-off" would have quietly
 * overwritten a pick-up's state with a drop-off's route, and the person would then be
 * reserved onto the wrong shuttle with nothing in the logs.
 */
export async function handleReadyForReservation(
	payload: ReadyForReservationPayload,
): Promise<Candidate | null> {
	const externalId = payload.external_request_id ?? null;
	if (!externalId) return null;

	if (!isLegDirection(payload.direction)) {
		console.error(
			`[reservation] ready-for-reservation for ${externalId} has no usable direction ` +
				`(got ${JSON.stringify(payload.direction)}); refusing to guess which leg it is`,
		);
		return null;
	}
	const direction = payload.direction;

	const candidate = await store.findByExternalId(externalId);
	if (!candidate) return null;

	upsertReservation(candidate, {
		...baseState(direction),
		trip: payload.trip ?? null,
		matched_route: payload.matched_route ?? null,
		frappe_candidate: payload.candidate ?? null,
	});
	if (payload.candidate) candidate.frappe_candidate = payload.candidate;
	await store.update(candidate);

	if ((process.env.AUTO_CONFIRM_RESERVATION ?? "false").toLowerCase() === "true") {
		requestReservation(candidate, direction).catch((err) => {
			console.error(`[reservation] auto-request failed: ${(err as Error).message}`);
		});
	}

	return candidate;
}

/**
 * Calls Frappe's request_reservation for one leg.
 *
 * `direction` is passed on every call, not only when the candidate has two legs. The
 * endpoint refuses an ambiguous request outright -- a two-leg candidate with no
 * direction throws naming the available ones -- and for a one-leg candidate the
 * parameter is simply redundant. Always sending it means the caller never has to know
 * how many legs exist.
 */
export async function requestReservation(
	candidate: Candidate,
	direction: LegDirection,
): Promise<Candidate> {
	if (!candidate.id) {
		console.error(`[reservation] cannot request reservation for ${candidate.name}: no external id`);
		return candidate;
	}

	const current = findReservation(candidate, direction) ?? baseState(direction);

	try {
		const result = await callFrappeMethod(
			"mmcy_fleet_management.api.dispatch.request_reservation",
			{ external_request_id: candidate.id, direction },
		);

		upsertReservation(candidate, {
			...current,
			status: result.ok ? "Requested" : "Failed",
			requested_at: new Date().toISOString(),
			response: result.body,
		});
		await store.update(candidate);

		if (!result.ok) {
			console.error(
				`[reservation] request_reservation non-2xx: ${result.status} (${direction})`,
			);
		} else {
			console.log(`[reservation] requested ${direction} reservation for ${candidate.name}`);
		}
		return candidate;
	} catch (err) {
		upsertReservation(candidate, {
			...current,
			status: "Failed",
			requested_at: new Date().toISOString(),
			response: { error: (err as Error).message },
		});
		await store.update(candidate);
		throw err;
	}
}
