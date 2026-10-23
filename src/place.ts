import type { ResolvedPlace } from "./types.ts";

const TIMEOUT_MS = 5000;
const PLACES_API = "https://places.googleapis.com/v1";

// Same scope as Fleet's own picker (mmcy_fleet_management dispatch_engine/geo.py):
// Ethiopia only, weighted toward the Addis Ababa metro, English results.
const ADDIS_CENTER = { latitude: 9.0108, longitude: 38.7613 };
const ADDIS_RADIUS_M = 30000;
const REGION_CODE = "et";
const LANGUAGE_CODE = "en";

/** Ethiopia's bounding box, used to drop out-of-country hits a bias alone lets through. */
const ETHIOPIA_BOUNDS = { minLat: 3.4, maxLat: 14.9, minLng: 33.0, maxLng: 48.0 };

/** Google's Autocomplete (New) returns at most five predictions. */
export const MAX_SUGGESTIONS = 5;

const EMPTY_PLACE: ResolvedPlace = {
	place_id: null,
	display_name: null,
	formatted_address: null,
	lat: null,
	lng: null,
};

export type PlaceSuggestion = {
	place_id: string;
	/** The place's own name, e.g. "Edna Mall". */
	display_name: string;
	/** The rest of the line, e.g. "Cameroon Street, Addis Ababa, Ethiopia". */
	secondary_text: string | null;
};

export type PlaceDetails = {
	place_id: string;
	formatted_address: string | null;
	lat: number;
	lng: number;
};

type Failure = { ok: false; reason: "no_key" | "upstream_error"; message: string };

export type SuggestionResult = { ok: true; suggestions: PlaceSuggestion[] } | Failure;
export type DetailsResult = { ok: true; place: PlaceDetails | null } | Failure;

/**
 * A small time-boxed cache. Every tester shares this process, so a landmark one person
 * already looked up costs nothing the next time anyone types it.
 */
class TtlCache<V> {
	private entries = new Map<string, { value: V; expires: number }>();

	constructor(
		private readonly maxEntries: number,
		private readonly ttlMs: number,
	) {}

	get(key: string): V | undefined {
		const hit = this.entries.get(key);
		if (!hit) return undefined;
		if (hit.expires < Date.now()) {
			this.entries.delete(key);
			return undefined;
		}
		return hit.value;
	}

	set(key: string, value: V): void {
		if (this.entries.size >= this.maxEntries) {
			// Map keeps insertion order, so the first key is the oldest.
			const oldest = this.entries.keys().next().value;
			if (oldest !== undefined) this.entries.delete(oldest);
		}
		this.entries.set(key, { value, expires: Date.now() + this.ttlMs });
	}
}

const suggestionCache = new TtlCache<PlaceSuggestion[]>(300, 10 * 60 * 1000);
const detailsCache = new TtlCache<PlaceDetails>(1000, 24 * 60 * 60 * 1000);

export function isInEthiopia(lat: number, lng: number): boolean {
	return (
		lat >= ETHIOPIA_BOUNDS.minLat &&
		lat <= ETHIOPIA_BOUNDS.maxLat &&
		lng >= ETHIOPIA_BOUNDS.minLng &&
		lng <= ETHIOPIA_BOUNDS.maxLng
	);
}

function normalizeQuery(text: string): string {
	return text.trim().toLowerCase().split(/\s+/).join(" ");
}

const ADDIS_BIAS = { circle: { center: ADDIS_CENTER, radius: ADDIS_RADIUS_M } };

type GoogleErrorBody = {
	error?: { status?: string; message?: string; details?: Array<{ reason?: string }> };
};

/** "REASON (STATUS): message" from a Google error body, or null when it has none. */
async function googleErrorDetail(res: Response): Promise<string | null> {
	try {
		const { error } = (await res.json()) as GoogleErrorBody;
		if (!error) return null;
		const reason = error.details?.find((d) => d.reason)?.reason;
		const label = [reason, error.status && `(${error.status})`].filter(Boolean).join(" ");
		const text = [label, error.message].filter(Boolean).join(": ");
		return text ? text.slice(0, 300) : null;
	} catch {
		return null;
	}
}

async function callPlaces(
	path: string,
	init: { method: "GET" | "POST"; fieldMask?: string; body?: unknown },
): Promise<{ ok: true; data: unknown } | Failure> {
	const key = process.env.GOOGLE_API_KEY;
	if (!key) return { ok: false, reason: "no_key", message: "GOOGLE_API_KEY is not set" };

	const headers: Record<string, string> = { "X-Goog-Api-Key": key };
	if (init.fieldMask) headers["X-Goog-FieldMask"] = init.fieldMask;
	if (init.body !== undefined) headers["Content-Type"] = "application/json";

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		const res = await fetch(`${PLACES_API}${path}`, {
			method: init.method,
			headers,
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
			signal: controller.signal,
		});
		if (!res.ok) {
			// Google's body names the actual cause (API disabled, key IP-restricted, billing
			// off). A bare "403 Forbidden" hides which of those to go and fix.
			const detail = await googleErrorDetail(res);
			console.warn(
				`[place] Google API non-2xx on ${path.split("?")[0]}: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`,
			);
			return {
				ok: false,
				reason: "upstream_error",
				message: `Google Places returned ${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}`,
			};
		}
		return { ok: true, data: await res.json() };
	} catch (err) {
		console.warn(`[place] Google API call failed: ${(err as Error).message}`);
		return { ok: false, reason: "upstream_error", message: (err as Error).message };
	} finally {
		clearTimeout(timeout);
	}
}

type AutocompleteResponse = {
	suggestions?: Array<{
		placePrediction?: {
			placeId?: string;
			text?: { text?: string };
			structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
		};
	}>;
};

/**
 * Live suggestions for the form's location fields: Google Autocomplete (New), limited
 * to Ethiopia and weighted toward Addis Ababa.
 *
 * Predictions carry no coordinates; `getPlaceDetails` resolves the one that is picked.
 * Passing the same `sessionToken` through every keystroke and the final details call
 * lets Google bill the whole search as one session rather than per request.
 */
export async function suggestPlaces(
	query: string,
	sessionToken: string | null,
): Promise<SuggestionResult> {
	const cacheKey = normalizeQuery(query);
	const cached = suggestionCache.get(cacheKey);
	if (cached) return { ok: true, suggestions: cached };

	const result = await callPlaces("/places:autocomplete", {
		method: "POST",
		body: {
			input: query,
			includedRegionCodes: [REGION_CODE],
			locationBias: ADDIS_BIAS,
			languageCode: LANGUAGE_CODE,
			regionCode: REGION_CODE,
			...(sessionToken ? { sessionToken } : {}),
		},
	});
	if (!result.ok) return result;

	const suggestions: PlaceSuggestion[] = [];
	for (const s of (result.data as AutocompleteResponse).suggestions ?? []) {
		const p = s.placePrediction;
		if (!p?.placeId) continue;
		const main = p.structuredFormat?.mainText?.text ?? p.text?.text ?? null;
		if (!main) continue;
		suggestions.push({
			place_id: p.placeId,
			display_name: main,
			secondary_text: p.structuredFormat?.secondaryText?.text ?? null,
		});
	}
	suggestionCache.set(cacheKey, suggestions);
	return { ok: true, suggestions };
}

type DetailsResponse = {
	id?: string;
	formattedAddress?: string;
	location?: { latitude?: number; longitude?: number };
};

/**
 * Coordinates and address for a picked suggestion.
 *
 * Asks only for id, address and location: the name is already on the suggestion, and
 * leaving `displayName` out of the field mask keeps the call in Google's cheaper
 * Essentials tier. Returns `place: null` when Google has no usable point for it or it
 * falls outside Ethiopia.
 */
export async function getPlaceDetails(
	placeId: string,
	sessionToken: string | null,
): Promise<DetailsResult> {
	const cached = detailsCache.get(placeId);
	if (cached) return { ok: true, place: cached };

	const params = new URLSearchParams({ languageCode: LANGUAGE_CODE, regionCode: REGION_CODE });
	if (sessionToken) params.set("sessionToken", sessionToken);
	const result = await callPlaces(`/places/${encodeURIComponent(placeId)}?${params}`, {
		method: "GET",
		fieldMask: "id,formattedAddress,location",
	});
	if (!result.ok) return result;

	const data = result.data as DetailsResponse;
	const lat = data.location?.latitude;
	const lng = data.location?.longitude;
	if (typeof lat !== "number" || typeof lng !== "number" || !isInEthiopia(lat, lng)) {
		return { ok: true, place: null };
	}
	const place: PlaceDetails = {
		place_id: data.id ?? placeId,
		formatted_address: data.formattedAddress ?? null,
		lat,
		lng,
	};
	detailsCache.set(placeId, place);
	return { ok: true, place };
}

type TextSearchResponse = {
	places?: Array<{
		id?: string;
		displayName?: { text?: string };
		formattedAddress?: string;
		location?: { latitude?: number; longitude?: number };
	}>;
};

/**
 * Create-time fallback for location text nobody picked from the suggestions.
 *
 * Text Search (New) cannot hard-restrict to a country, so it is weighted toward Addis
 * and asked for a few results; the first one inside Ethiopia wins.
 */
export async function resolvePlace(rawText: string): Promise<ResolvedPlace> {
	const result = await callPlaces("/places:searchText", {
		method: "POST",
		fieldMask: "places.id,places.displayName,places.formattedAddress,places.location",
		body: {
			textQuery: rawText,
			locationBias: ADDIS_BIAS,
			languageCode: LANGUAGE_CODE,
			regionCode: REGION_CODE,
			pageSize: 5,
		},
	});
	if (!result.ok) return EMPTY_PLACE;

	const first = ((result.data as TextSearchResponse).places ?? []).find((p) => {
		const lat = p.location?.latitude;
		const lng = p.location?.longitude;
		return typeof lat === "number" && typeof lng === "number" && isInEthiopia(lat, lng);
	});
	if (!first) {
		console.warn(`[place] no result inside Ethiopia for "${rawText}"`);
		return EMPTY_PLACE;
	}
	return {
		place_id: first.id ?? null,
		display_name: first.displayName?.text ?? null,
		formatted_address: first.formattedAddress ?? null,
		lat: first.location?.latitude ?? null,
		lng: first.location?.longitude ?? null,
	};
}
