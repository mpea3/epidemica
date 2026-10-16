import { BrowserView, BrowserWindow, Utils } from "electrobun/bun";
import { RESOURCES_FOLDER, VIEWS_FOLDER } from "electrobun/bun/paths";
import { mkdir, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { type Outbreak, type OutbreakFile, type OutbreakInfo, toColumns } from "../shared/outbreak";
import type { CsvPreview, EpidemicaRPC, ImportRequest, ImportResult, RResult } from "../shared/rpc";

// r/ and data/ are copied next to the views at build time (see
// electrobun.config.ts).
const R_FOLDER = join(RESOURCES_FOLDER, "app", "r");
const DATA_FOLDER = join(RESOURCES_FOLDER, "app", "data");
// Imported datasets go in the app's own folder (~/.local/share/<identifier>/
// on Linux), not in data/, which a rebuild replaces. fit.R finds them
// through EPIDEMICA_USER_DATA.
const IMPORT_FOLDER = join(Utils.paths.userData, "data");
await mkdir(IMPORT_FOLDER, { recursive: true });

// Outbreak ids are file names in data/ without .json, so the view cannot
// read anything outside that folder.
const OUTBREAK_ID = /^[a-z0-9_]+$/;

// The folder an outbreak's file is in: data/ first, then the imports.
// r/import.R refuses an id data/ already has, so there is only ever one.
async function folderOf(id: string): Promise<string> {
	for (const folder of [DATA_FOLDER, IMPORT_FOLDER]) {
		if (await Bun.file(join(folder, `${id}.json`)).exists()) return folder;
	}
	throw new Error(`no dataset ${id}`);
}

async function readOutbreak(id: string): Promise<Outbreak> {
	if (!OUTBREAK_ID.test(id)) throw new Error(`not an outbreak id: ${id}`);
	const folder = await folderOf(id);
	const file: OutbreakFile = await Bun.file(join(folder, `${id}.json`)).json();
	return { ...toColumns(file), imported: folder === IMPORT_FOLDER };
}

async function idsIn(folder: string): Promise<string[]> {
	return (await readdir(folder))
		.filter((name) => name.endsWith(".json"))
		.map((name) => name.slice(0, -".json".length))
		.filter((id) => OUTBREAK_ID.test(id));
}

// Every outbreak in data/ and the imports, sorted by name, without the
// numbers.
async function listOutbreaks(): Promise<OutbreakInfo[]> {
	const ids = [...new Set([...(await idsIn(DATA_FOLDER)), ...(await idsIn(IMPORT_FOLDER))])];
	const outbreaks = await Promise.all(ids.map(readOutbreak));
	return outbreaks
		.map(({ dates, columns, ...info }) => info)
		.sort((a, b) => a.name.localeCompare(b.name));
}

// Only scripts in r/, named like fit.R, so the view cannot run anything else.
const SCRIPT_NAME = /^[a-z0-9_]+\.R$/;

async function runR(script: string, args: string[]): Promise<RResult> {
	if (!SCRIPT_NAME.test(script)) {
		return { ok: false, error: `not an R script name: ${script}` };
	}
	try {
		const proc = Bun.spawn(["Rscript", join(R_FOLDER, script), ...args], {
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, EPIDEMICA_USER_DATA: IMPORT_FOLDER },
		});
		const [stdout, stderr, code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		if (code !== 0) {
			return { ok: false, error: stderr.trim() || `Rscript exited with ${code}` };
		}
		return { ok: true, data: JSON.parse(stdout) };
	} catch (err) {
		return { ok: false, error: String(err) };
	}
}

// What r/import.R prints: its own { ok, ... }. A failed Rscript (R missing,
// a package not installed) is turned into the same shape.
async function runImport(args: string[]): Promise<{ ok: boolean; error?: string } & Record<string, unknown>> {
	const result = await runR("import.R", args);
	if (!result.ok) return { ok: false, error: result.error };
	return result.data as { ok: boolean } & Record<string, unknown>;
}

// The CSV the user last picked. The view refers to it, never to a path, so
// it cannot make R read some other file.
let pickedCsv: string | null = null;

async function pickCsv(): Promise<{ ok: true; csv: CsvPreview | null } | { ok: false; error: string }> {
	const [path] = await Utils.openFileDialog({
		startingFolder: Utils.paths.home,
		allowedFileTypes: "csv,tsv,txt",
		canChooseFiles: true,
		canChooseDirectory: false,
		allowsMultipleSelection: false,
	});
	if (!path) return { ok: true, csv: null };
	const result = await runImport(["--inspect", path]);
	if (!result.ok) return { ok: false, error: result.error ?? "could not read the CSV" };
	pickedCsv = path;
	const { columns, rows, guess } = result as unknown as CsvPreview;
	return { ok: true, csv: { file: basename(path), columns, rows, guess } };
}

async function importCsv(form: ImportRequest): Promise<ImportResult> {
	if (!pickedCsv) return { ok: false, error: "pick a CSV first" };
	const args = [
		"--csv", pickedCsv,
		"--out", IMPORT_FOLDER,
		"--id", form.id,
		"--name", form.name || form.id,
		"--date", form.date,
		"--date-format", form.dateFormat || "%Y-%m-%d",
		"--disease", form.disease,
	];
	if (form.cases) args.push("--cases", form.cases);
	if (form.deaths) args.push("--deaths", form.deaths);
	if (form.pathogen) args.push("--pathogen", form.pathogen);
	if (form.source) args.push("--source", form.source);
	if (form.licence) args.push("--licence", form.licence);
	if (form.growthWindow) args.push("--growth-from", form.growthWindow[0], "--growth-to", form.growthWindow[1]);
	return (await runImport(args)) as unknown as ImportResult;
}

const rpc = BrowserView.defineRPC<EpidemicaRPC>({
	// R fits can take a while, and pickCsv waits for the user to choose a
	// file. Keep in step with the view's maxRequestTime.
	maxRequestTime: 10 * 60_000,
	handlers: {
		requests: {
			runR: ({ script, args }) => runR(script, args),
			engineSource: () => Bun.file(join(VIEWS_FOLDER, "engine", "index.js")).text(),
			outbreaks: () => listOutbreaks(),
			outbreak: ({ id }) => readOutbreak(id),
			pickCsv: () => pickCsv(),
			diseases: async () => {
				const result = await runImport(["--diseases"]);
				return result.ok
					? { ok: true, diseases: result["diseases"] as never }
					: { ok: false, error: result.error ?? "no diseases" };
			},
			importCsv: (form) => importCsv(form),
		},
		messages: {
			log: ({ text }) => console.log(`[view] ${text}`),
		},
	},
});

new BrowserWindow({
	title: "Epidemica",
	url: "views://mainview/index.html",
	frame: { width: 1200, height: 800, x: 100, y: 100 },
	rpc,
});
