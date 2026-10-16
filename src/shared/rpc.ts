// Messages between the main process and the webview. Both sides import this
// type, so a request with the wrong params or response fails to compile.
import type { RPCSchema } from "electrobun";
import type { Outbreak, OutbreakInfo } from "./outbreak";

// What Rscript printed, parsed as JSON, or why it failed.
export type RResult =
	| { ok: true; data: unknown }
	| { ok: false; error: string };

// A CSV picked for import, as r/import.R --inspect describes it.
export interface CsvPreview {
	file: string; // the file name, for the form's heading
	columns: string[];
	rows: string[][]; // the first few rows, every value as text
	// Which column r/import.R thinks is which, from the names.
	guess: { date: string | null; cases: string | null; deaths: string | null };
}

// A disease a dataset can be tagged with, from epiparameter.
export interface DiseaseOption {
	disease: string;
	pathogens: string[];
	canFit: boolean; // false: no serial interval, so no R0 or R(t)
}

// The import form, for r/import.R. The CSV is the one pickCsv last returned;
// the main process remembers it, so the view never sends a path.
export interface ImportRequest {
	id: string;
	name: string;
	date: string; // column names in the CSV
	cases: string | null; // null: a line list, one row per case
	deaths: string | null;
	dateFormat: string; // strptime, e.g. %Y-%m-%d
	disease: string;
	pathogen: string | null;
	source: string;
	licence: string;
	growthWindow: [string, string] | null;
}

export type ImportResult =
	| { ok: true; id: string; rows: number; interval: string; warnings: string[] }
	| { ok: false; error: string; problems?: string[] };

export type EpidemicaRPC = {
	// Requests the main process answers.
	bun: RPCSchema<{
		requests: {
			// Run one of the scripts in r/ and return its JSON output.
			runR: {
				params: { script: string; args: string[] };
				response: RResult;
			};
			// Source of the engine bundle (views/engine/index.js), which the view
			// starts as a Web Worker. WebKitGTK will neither start a Worker from
			// a views:// URL nor fetch one.
			engineSource: {
				params: void;
				response: string;
			};
			// What is in data/, for the History tab's list. No numbers, so the
			// list stays small.
			outbreaks: {
				params: void;
				response: OutbreakInfo[];
			};
			// One outbreak with its numbers, from data/<id>.json.
			outbreak: {
				params: { id: string };
				response: Outbreak;
			};
			// Opens a file dialog and describes the CSV picked; null if the user
			// cancelled.
			pickCsv: {
				params: void;
				response: { ok: true; csv: CsvPreview | null } | { ok: false; error: string };
			};
			// Diseases for the import form.
			diseases: {
				params: void;
				response: { ok: true; diseases: DiseaseOption[] } | { ok: false; error: string };
			};
			// Checks the picked CSV and writes it as an imported dataset.
			importCsv: {
				params: ImportRequest;
				response: ImportResult;
			};
		};
		messages: {
			// A line from the webview for the terminal running the app.
			log: { text: string };
		};
	}>;
	// Requests the webview answers. None yet.
	webview: RPCSchema;
};
