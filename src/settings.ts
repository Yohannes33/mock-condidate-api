export type RecruiterSettings = {
	email: string;
	name: string;
};

const DATA_DIR = new URL("../data/", import.meta.url);
const SETTINGS_FILE = new URL("./settings.json", DATA_DIR);

let cache: RecruiterSettings | null = null;

async function read(): Promise<RecruiterSettings | null> {
	if (cache) return cache;
	const file = Bun.file(SETTINGS_FILE);
	if (!(await file.exists())) {
		cache = null;
		return cache;
	}
	const text = await file.text();
	const parsed = text.trim() ? (JSON.parse(text) as RecruiterSettings) : null;
	cache = parsed;
	return cache;
}

async function write(settings: RecruiterSettings): Promise<void> {
	cache = settings;
	await Bun.write(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

export async function get(): Promise<RecruiterSettings | null> {
	return read();
}

export async function set(email: string, name: string): Promise<RecruiterSettings> {
	const settings: RecruiterSettings = { email, name };
	await write(settings);
	return settings;
}
