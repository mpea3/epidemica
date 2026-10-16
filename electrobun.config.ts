import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "Epidemica",
		identifier: "dev.mae.epidemica",
		version: "0.1.0",
	},
	build: {
		// The real Bun runtime, so the main process can use Bun.spawn for Rscript.
		mainProcess: "bun",
		bun: {
			entrypoint: "src/bun/index.ts",
		},
		views: {
			mainview: {
				entrypoint: "src/mainview/index.ts",
			},
			// The simulation engine, bundled on its own so the view can start it
			// as a Web Worker.
			engine: {
				entrypoint: "src/engine/worker.ts",
			},
		},
		copy: {
			"src/mainview/index.html": "views/mainview/index.html",
			"src/mainview/style.css": "views/mainview/style.css",
			"node_modules/uplot/dist/uPlot.min.css": "views/mainview/uplot.css",
			r: "r",
			data: "data",
		},
		mac: { bundleCEF: false },
		linux: { bundleCEF: false },
		win: { bundleCEF: false },
	},
} satisfies ElectrobunConfig;
