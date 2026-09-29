import type { TripView } from "./types.ts";

const TIMEOUT_MS = 8000;

/** Resolves a Frappe whitelisted method to a full URL, reusing WEBHOOK_URL's origin. */
export function frappeMethodUrl(method: string): string | null {
	const base = process.env.FRAPPE_BASE_URL ?? process.env.WEBHOOK_URL;
	if (!base) return null;
	try {
		const url = new URL(base);
		url.pathname = `/api/method/${method}`;
		url.search = "";
		return url.toString();
	} catch {
		return null;
	}
}

export type FrappeCallResult = {
	ok: boolean;
	status: number;
	body: unknown;
};

/** POSTs form-encoded params to a Frappe whitelisted method, authenticated with API_KEY. */
export async function callFrappeMethod(
	method: string,
	params: Record<string, string>,
): Promise<FrappeCallResult> {
	const url = frappeMethodUrl(method);
	if (!url) {
		throw new Error("no Frappe URL configured (set WEBHOOK_URL or FRAPPE_BASE_URL)");
	}

	const headers: Record<string, string> = {
		"Content-Type": "application/x-www-form-urlencoded",
	};
	const apiKey = process.env.API_KEY;
	if (apiKey) headers["Authorization"] = `token ${apiKey}`;

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

	try {
		const res = await fetch(url, {
			method: "POST",
			headers,
			body: new URLSearchParams(params).toString(),
			signal: controller.signal,
		});
		const text = await res.text();
		let body: unknown = text;
		try {
			body = JSON.parse(text);
		} catch {
			// leave as raw text
		}
		return { ok: res.ok, status: res.status, body };
	} finally {
		clearTimeout(timeout);
	}
}

export type CandidateTrips = {
	candidate: string | null;
	candidate_name: string | null;
	/** Frappe's rollup: the least-advanced live leg. One word for a list view. */
	candidate_status: string | null;
	trips: TripView[];
};

/**
 * Reads every leg of a Frappe Candidate, each with its own status and route.
 *
 * Replaces a `frappe.client.get_value` read of `Candidate.status`, which no longer
 * exists -- that field was deleted when pick-up and drop-off became separate trips,
 * because no single word describes a person whose pick-up is reserved and whose
 * drop-off was denied.
 *
 * Worth knowing how that broke: `get_value` on a missing field does not error, it
 * returns an empty result. So the old call reported "no status" for every candidate,
 * silently and forever. Nothing here would have told us.
 *
 * `candidate_status` is still on the response for callers that only want the one-word
 * summary -- computed server-side rather than re-derived here.
 */
export async function getCandidateTrips(
	frappeCandidateName: string,
): Promise<CandidateTrips | null> {
	try {
		const result = await callFrappeMethod(
			"mmcy_fleet_management.api.dispatch.get_candidate_trips",
			{ name: frappeCandidateName },
		);
		if (!result.ok) {
			console.warn(`[frappe] get_candidate_trips non-2xx: ${result.status}`);
			return null;
		}
		const body = result.body as { message?: CandidateTrips };
		return body?.message ?? null;
	} catch (err) {
		console.warn(`[frappe] get_candidate_trips failed: ${(err as Error).message}`);
		return null;
	}
}
