import { Electroview } from "electrobun/view";
import type { FromWorker } from "../engine/worker";
import type { EpidemicaRPC } from "../shared/rpc";
import { fitCache } from "./fits";
import { initHistory } from "./history";
import { initImport } from "./import";
import { type SimulateHandle, initSimulate } from "./simulate";

const rpc = Electroview.defineRPC<EpidemicaRPC>({
	// R fits and the CSV file dialog (see pickCsv in src/bun/index.ts).
	maxRequestTime: 10 * 60_000,
	handlers: { requests: {}, messages: {} },
});
const electroview = new Electroview({ rpc });

// Shows in the terminal that runs the app.
const log = (text: string) => electroview.rpc!.send.log({ text });

const rStatus = document.querySelector<HTMLOutputElement>("#r-status")!;
const engineStatus = document.querySelector<HTMLOutputElement>("#engine-status")!;

// Tabs: show the section whose id matches the button's data-tab.
const tabs = document.querySelectorAll<HTMLButtonElement>("nav button");
function showTab(name: string): void {
	for (const tab of tabs) {
		const active = tab.dataset["tab"] === name;
		tab.setAttribute("aria-pressed", String(active));
		document.getElementById(tab.dataset["tab"]!)!.hidden = !active;
	}
}
for (const tab of tabs) tab.addEventListener("click", () => showTab(tab.dataset["tab"]!));

// One cache of R's fits for both tabs, so fitting in History and loading
// into Simulate run R once between them (see fits.ts).
const fits = fitCache((id) => electroview.rpc!.request.runR({ script: "fit.R", args: ["--outbreak", id] }));
const outbreaks = {
	list: () => electroview.rpc!.request.outbreaks(),
	load: (id: string) => electroview.rpc!.request.outbreak({ id }),
	fits,
	log,
};

// Checks the main process can run R and get JSON back.
async function pingR() {
	rStatus.textContent = "R: asking...";
	const result = await electroview.rpc!.request.runR({
		script: "fit.R",
		args: ["--ping"],
	});
	rStatus.textContent = result.ok
		? `R: ${JSON.stringify(result.data)}`
		: `R failed: ${result.error}`;
	log(rStatus.textContent);
}
document.querySelector("#ping-r")!.addEventListener("click", pingR);

// The engine runs in its own bundle. The main process hands over its source
// and the worker starts from a Blob (see engineSource in shared/rpc.ts).
async function startEngine(): Promise<Worker> {
	const code = await electroview.rpc!.request.engineSource();
	const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
	return new Worker(url);
}

// The Simulate tab, once the engine has started. History's "load into
// simulator" can be pressed before that, so it waits for this.
const simulateReady: Promise<SimulateHandle> = startEngine().then((engine) => {
	engine.addEventListener("message", (event: MessageEvent<FromWorker>) => {
		if (event.data.type === "ready") {
			engineStatus.textContent = "engine: ready";
			log(engineStatus.textContent);
		}
	});
	return initSimulate(engine, outbreaks);
});
simulateReady.catch((err) => {
	engineStatus.textContent = `engine failed: ${err}`;
	log(engineStatus.textContent);
});

pingR();

// History's "load into simulator": show the Simulate tab, which then fits
// and loads the outbreak itself and says what it is doing.
function loadIntoSimulator(id: string): void {
	showTab("simulate");
	simulateReady.then((simulate) => simulate.loadFromHistory(id)).catch(() => {
		// The engine failed to start; the footer already says so.
	});
}

// index.html loads this bundle as a classic script, so no top-level await.
initHistory(outbreaks, loadIntoSimulator).then((reloadHistory) =>
	initImport(
		{
			pickCsv: () => electroview.rpc!.request.pickCsv(),
			diseases: () => electroview.rpc!.request.diseases(),
			importCsv: (form) => electroview.rpc!.request.importCsv(form),
			log,
		},
		// After an import both tabs' lists need the new dataset.
		async (select) => {
			await reloadHistory(select);
			(await simulateReady).refreshList();
		},
	),
);
