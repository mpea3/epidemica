import { BrowserView, BrowserWindow } from "electrobun/bun";
import { RESOURCES_FOLDER, VIEWS_FOLDER } from "electrobun/bun/paths";
import { join } from "node:path";
import type { EpidemicaRPC, RResult } from "../shared/rpc";

// r/ is copied next to the views at build time (see electrobun.config.ts).
const R_FOLDER = join(RESOURCES_FOLDER, "app", "r");

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
