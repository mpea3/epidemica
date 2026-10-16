import { BrowserView, BrowserWindow } from "electrobun/bun";
import { RESOURCES_FOLDER, VIEWS_FOLDER } from "electrobun/bun/paths";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { type Outbreak, type OutbreakFile, type OutbreakInfo, toColumns } from "../shared/outbreak";
import type { EpidemicaRPC, RResult } from "../shared/rpc";

// r/ and data/ are copied next to the views at build time (see
// electrobun.config.ts).
const R_FOLDER = join(RESOURCES_FOLDER, "app", "r");
const DATA_FOLDER = join(RESOURCES_FOLDER, "app", "data");

// Outbreak ids are file names in data/ without .json, so the view cannot
// read anything outside that folder.
const OUTBREAK_ID = /^[a-z0-9_]+$/;

async function readOutbreak(id: string): Promise<Outbreak> {
	if (!OUTBREAK_ID.test(id)) throw new Error(`not an outbreak id: ${id}`);
	const file: OutbreakFile = await Bun.file(join(DATA_FOLDER, `${id}.json`)).json();
	return toColumns(file);
}

// Every outbreak in data/, sorted by name, without the numbers.
async function listOutbreaks(): Promise<OutbreakInfo[]> {
	const ids = (await readdir(DATA_FOLDER))
		.filter((name) => name.endsWith(".json"))
		.map((name) => name.slice(0, -".json".length));
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

const rpc = BrowserView.defineRPC<EpidemicaRPC>({
	// R fits can take a while.
	maxRequestTime: 60_000,
	handlers: {
		requests: {
			runR: ({ script, args }) => runR(script, args),
			engineSource: () => Bun.file(join(VIEWS_FOLDER, "engine", "index.js")).text(),
			outbreaks: () => listOutbreaks(),
			outbreak: ({ id }) => readOutbreak(id),
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
