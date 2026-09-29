import type { Candidate, ReservationState } from "./types.ts";
import { seedCandidates } from "./seed.ts";

/** The pre-per-leg record shape, as it still sits in data/candidates.json. */
type LegacyReservation = Omit<ReservationState, "direction" | "trip">;

type LegacyCandidate = Record<string, unknown> & {
	reservation?: LegacyReservation | null;
	reservations?: ReservationState[];
};

/**
 * Brings a stored record up to the per-leg shape.
 *
 * Migrating on read rather than shipping a one-shot script, because this file is the
 * mock's only store and it holds 48 hand-entered candidates plus 19 live reservation
 * states. Resetting would be the easy option and would throw all of that away.
 *
 * The legacy `reservation` object carries no direction, so it becomes the **drop-off**
 * leg. That is not a guess: drop-off was the only intake shape the mock could produce
 * before this change, so every already-stored reservation is necessarily a drop-off.
 */
function normalize(raw: LegacyCandidate): Candidate {
	const legacy = raw.reservation;
	const reservations: ReservationState[] =
		raw.reservations ??
		(legacy
			? [
					{
						status: legacy.status,
						direction: "Drop-off",
						trip: null,
						matched_route: legacy.matched_route ?? null,
						frappe_candidate: legacy.frappe_candidate ?? null,
						notified_at: legacy.notified_at,
						requested_at: legacy.requested_at ?? null,
						response: legacy.response ?? null,
					},
				]
			: []);

	const { reservation: _legacyField, ...rest } = raw;
	const directions = raw.requested_directions;

	return {
		...rest,
		requested_directions:
			directions === "Pick-up" || directions === "Both" ? directions : "Drop-off",
		pickup_location: (raw.pickup_location as string | null) ?? null,
		pickup_place: (raw.pickup_place as Candidate["pickup_place"]) ?? null,
		reservations,
	} as Candidate;
}

const DATA_DIR = new URL("../data/", import.meta.url);
const DATA_FILE = new URL("./candidates.json", DATA_DIR);

let cache: Candidate[] | null = null;

async function ensureDataDir(): Promise<void> {
	const dir = Bun.file(DATA_FILE);
	if (!(await dir.exists())) {
		await Bun.write(DATA_FILE, JSON.stringify(seedCandidates, null, 2));
	}
}

export async function load(): Promise<Candidate[]> {
	if (cache) return cache;
	await ensureDataDir();
	const file = Bun.file(DATA_FILE);
	const text = await file.text();
	const parsed = text.trim() ? (JSON.parse(text) as LegacyCandidate[]) : [];
	const migrated = parsed.filter((c) => c.reservations === undefined).length;
	if (migrated) {
		console.log(`[store] migrated ${migrated} record(s) to the per-leg shape on read`);
	}
	cache = parsed.map(normalize);
	return cache;
}

async function persist(candidates: Candidate[]): Promise<void> {
	cache = candidates;
	await Bun.write(DATA_FILE, JSON.stringify(candidates, null, 2));
}

export async function list(): Promise<Candidate[]> {
	const items = await load();
	return [...items];
}

export async function get(name: string): Promise<Candidate | undefined> {
	const items = await load();
	return items.find((c) => c.name === name);
}

export async function has(name: string): Promise<boolean> {
	const items = await load();
	return items.some((c) => c.name === name);
}

export async function findByExternalId(id: string): Promise<Candidate | undefined> {
	const items = await load();
	return items.find((c) => c.id === id);
}

export async function generateExternalId(): Promise<string> {
	const items = await load();
	let max = 1000;
	for (const c of items) {
		const match = c.id?.match(/^REQ-(\d+)$/);
		if (match) max = Math.max(max, Number(match[1]));
	}
	return `REQ-${max + 1}`;
}

export async function insert(candidate: Candidate): Promise<Candidate> {
	const items = await load();
	items.push(candidate);
	await persist(items);
	return candidate;
}

export async function update(candidate: Candidate): Promise<Candidate> {
	const items = await load();
	const idx = items.findIndex((c) => c.name === candidate.name);
	if (idx === -1) {
		throw new Error(`Candidate '${candidate.name}' not found`);
	}
	items[idx] = candidate;
	await persist(items);
	return candidate;
}

export async function reset(): Promise<Candidate[]> {
	const fresh = [...seedCandidates];
	await persist(fresh);
	return fresh;
}
