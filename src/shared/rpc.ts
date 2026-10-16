// Messages between the main process and the webview. Both sides import this
// type, so a request with the wrong params or response fails to compile.
import type { RPCSchema } from "electrobun";

// What Rscript printed, parsed as JSON, or why it failed.
export type RResult =
	| { ok: true; data: unknown }
	| { ok: false; error: string };

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
		};
		messages: {
			// A line from the webview for the terminal running the app.
			log: { text: string };
		};
	}>;
	// Requests the webview answers. None yet.
	webview: RPCSchema;
};
