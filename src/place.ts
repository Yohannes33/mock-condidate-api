import type { ResolvedPlace } from "./types.ts";

const TIMEOUT_MS = 5000;

/** Google's Text Search (New) caps a page at 20 results. */
export const MAX_SEARCH_RESULTS = 20;

const EMPTY_PLACE: ResolvedPlace = {
	place_id: null,
	display_name: null,
	formatted_address: null,
	lat: null,
	lng: null,
};

type PlacesApiNewResponse = {
	places?: Array<{
		id?: string;
		displayName?: { text?: string; languageCode?: string };
		formattedAddress?: string;
		location?: { latitude?: number; longitude?: number };
	}>;
};

export type PlaceSearchResult =
	| { ok: true; places: ResolvedPlace[] }
	| { ok: false; reason: "no_key" | "upstream_error"; message: string };

/**
 * Text-searches Google Places and returns up to `limit` matches.
 *
 * The form's live suggestions and the create-time fallback both go through here, so a
 * place picked from the dropdown is exactly what an unpicked lookup of the same text
 * would have resolved to — the two paths cannot drift.
 */
export async function searchPlaces(query: string, limit: number): Promise<PlaceSearchResult> {
	const key = process.env.GOOGLE_API_KEY;
	if (!key) {
		return { ok: false, reason: "no_key", message: "GOOGLE_API_KEY is not set" };
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

	try {
		const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Goog-Api-Key": key,
				"X-Goog-FieldMask":
					"places.id,places.displayName,places.formattedAddress,places.location",
			},
			body: JSON.stringify({
				textQuery: query,
				pageSize: Math.min(Math.max(limit, 1), MAX_SEARCH_RESULTS),
			}),
			signal: controller.signal,
		});
		if (!res.ok) {
			console.warn(`[place] Google API non-2xx: ${res.status} ${res.statusText}`);
			return {
				ok: false,
				reason: "upstream_error",
				message: `Google Places returned ${res.status} ${res.statusText}`,
			};
		}
		const data = (await res.json()) as PlacesApiNewResponse;
		const places = (data.places ?? []).map((p) => ({
			place_id: p.id ?? null,
			display_name: p.displayName?.text ?? null,
			formatted_address: p.formattedAddress ?? null,
			lat: p.location?.latitude ?? null,
			lng: p.location?.longitude ?? null,
		}));
		return { ok: true, places };
	} catch (err) {
		console.warn(`[place] Google API call failed: ${(err as Error).message}`);
		return { ok: false, reason: "upstream_error", message: (err as Error).message };
	} finally {
		clearTimeout(timeout);
	}
}

export async function resolvePlace(rawText: string): Promise<ResolvedPlace> {
	const result = await searchPlaces(rawText, 1);
	if (!result.ok) return EMPTY_PLACE;
	const first = result.places[0];
	if (!first) {
		console.warn(`[place] no results for "${rawText}"`);
		return EMPTY_PLACE;
	}
	return first;
}
