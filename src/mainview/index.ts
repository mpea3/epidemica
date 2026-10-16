import { Electroview } from "electrobun/view";
import type { FromWorker } from "../engine/worker";
import type { EpidemicaRPC } from "../shared/rpc";
import { initHistory } from "./history";

const rpc = Electroview.defineRPC<EpidemicaRPC>({
	maxRequestTime: 60_000,
	handlers: { requests: {}, messages: {} },
});
const electroview = new Electroview({ rpc });

// Shows in the terminal that runs the app.
const log = (text: string) => electroview.rpc!.send.log({ text });

const rStatus = document.querySelector<HTMLOutputElement>("#r-status")!;
const engineStatus = document.querySelector<HTMLOutputElement>("#engine-status")!;

// Tabs: show the section whose id matches the button's data-tab.
const tabs = document.querySelectorAll<HTMLButtonElement>("nav button");
for (const tab of tabs) {
	tab.addEventListener("click", () => {
		for (const other of tabs) {
			const active = other === tab;
			other.setAttribute("aria-pressed", String(active));
			document.getElementById(other.dataset["tab"]!)!.hidden = !active;
		}
	});
}

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

startEngine()
	.then((engine) => {
		engine.onmessage = (event: MessageEvent<FromWorker>) => {
			if (event.data.type === "ready") {
				engineStatus.textContent = "engine: ready";
				log(engineStatus.textContent);
			}
		};
	})
	.catch((err) => {
		engineStatus.textContent = `engine failed: ${err}`;
		log(engineStatus.textContent);
	});

pingR();

initHistory({
	list: () => electroview.rpc!.request.outbreaks(),
	load: (id) => electroview.rpc!.request.outbreak({ id }),
	log,
});
