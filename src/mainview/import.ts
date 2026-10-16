// The History tab's import: pick a CSV, say which column is the date, the
// cases and the deaths, name the disease, and let r/import.R check it and
// write it. The checking happens in R; this file only fills in the form.
import { guessDateFormat, idFromName } from "../shared/importing";
import type { CsvPreview, DiseaseOption, EpidemicaRPC, ImportRequest } from "../shared/rpc";

type Requests = EpidemicaRPC["bun"]["requests"];

// How the form reaches the main process; index.ts passes in the RPC requests.
export interface ImportSource {
	pickCsv: () => Promise<Requests["pickCsv"]["response"]>;
	diseases: () => Promise<Requests["diseases"]["response"]>;
	importCsv: (form: ImportRequest) => Promise<Requests["importCsv"]["response"]>;
	log: (text: string) => void;
}

const pickButton = document.querySelector<HTMLButtonElement>("#import-pick")!;
const status = document.querySelector<HTMLParagraphElement>("#import-status")!;
const form = document.querySelector<HTMLFormElement>("#import-form")!;
const fileName = document.querySelector<HTMLSpanElement>("#import-file")!;
const preview = document.querySelector<HTMLTableElement>("#import-preview")!;
const result = document.querySelector<HTMLDivElement>("#import-result")!;
const field = <T extends HTMLElement>(name: string) => form.elements.namedItem(name) as T;

const dateSelect = field<HTMLSelectElement>("date");
const casesSelect = field<HTMLSelectElement>("cases");
const deathsSelect = field<HTMLSelectElement>("deaths");
const dateFormat = field<HTMLInputElement>("dateFormat");
const nameInput = field<HTMLInputElement>("name");
const idInput = field<HTMLInputElement>("id");
const diseaseSelect = field<HTMLSelectElement>("disease");
const pathogenSelect = field<HTMLSelectElement>("pathogen");

let csv: CsvPreview | null = null;
let diseases: DiseaseOption[] = [];
// The id follows the name until the user types an id of their own.
let idEdited = false;

function options(select: HTMLSelectElement, items: [label: string, value: string][], selected?: string | null): void {
	select.replaceChildren(...items.map(([label, value]) => new Option(label, value)));
	if (selected != null && items.some(([, value]) => value === selected)) select.value = selected;
}

// The first rows of the CSV, so the user can see which column is which.
function drawPreview(csv: CsvPreview): void {
	const row = (cells: string[], tag: "th" | "td") => {
		const tr = document.createElement("tr");
		for (const cell of cells) {
			const td = document.createElement(tag);
			td.textContent = cell;
			tr.append(td);
		}
		return tr;
	};
	preview.replaceChildren(row(csv.columns, "th"), ...csv.rows.map((r) => row(r, "td")));
}

// A date format guessed from the date column's values in the preview.
function updateDateFormat(): void {
	if (!csv) return;
	const i = csv.columns.indexOf(dateSelect.value);
	dateFormat.value = guessDateFormat(csv.rows.map((r) => r[i] ?? ""));
}

function updatePathogens(): void {
	const disease = diseases.find((d) => d.disease === diseaseSelect.value);
	options(pathogenSelect, [["(any)", ""], ...(disease?.pathogens ?? []).map((p): [string, string] => [p, p])]);
}

async function loadDiseases(source: ImportSource): Promise<void> {
	if (diseases.length > 0) return;
	const reply = await source.diseases();
	if (!reply.ok) throw new Error(reply.error);
	diseases = reply.diseases;
	options(
		diseaseSelect,
		// Diseases without a serial interval can be charted but not fitted.
		diseases.map((d) => [d.canFit ? d.disease : `${d.disease} (no R0)`, d.disease]),
	);
	updatePathogens();
}

function openForm(picked: CsvPreview): void {
	csv = picked;
	fileName.textContent = picked.file;
	drawPreview(picked);
	const columns = picked.columns.map((c): [string, string] => [c, c]);
	options(dateSelect, columns, picked.guess.date ?? picked.columns[0]);
	options(casesSelect, [["(none: one row per case)", ""], ...columns], picked.guess.cases ?? "");
	options(deathsSelect, [["(none)", ""], ...columns], picked.guess.deaths ?? "");
	updateDateFormat();
	nameInput.value = picked.file.replace(/\.[^.]+$/, "");
	idInput.value = idFromName(nameInput.value);
	idEdited = false;
	result.replaceChildren();
	form.hidden = false;
}

function showError(error: string, problems: string[] = []): void {
	const p = document.createElement("p");
	p.className = "error";
	p.textContent = error;
	const list = document.createElement("ul");
	for (const problem of problems) {
		const li = document.createElement("li");
		li.textContent = problem;
		list.append(li);
	}
	result.replaceChildren(p, ...(problems.length > 0 ? [list] : []));
}

function request(): ImportRequest {
	const from = field<HTMLInputElement>("growthFrom").value;
	const to = field<HTMLInputElement>("growthTo").value;
	return {
		id: idInput.value,
		name: nameInput.value,
		date: dateSelect.value,
		cases: casesSelect.value || null,
		deaths: deathsSelect.value || null,
		dateFormat: dateFormat.value,
		disease: diseaseSelect.value,
		pathogen: pathogenSelect.value || null,
		source: field<HTMLInputElement>("source").value,
		licence: field<HTMLInputElement>("licence").value,
		growthWindow: from && to ? [from, to] : null,
	};
}

// onImported gets the new dataset's id, so the History tab can show it.
export function initImport(source: ImportSource, onImported: (id: string) => Promise<void>): void {
	pickButton.addEventListener("click", async () => {
		status.textContent = "choose a CSV...";
		try {
			const [picked] = await Promise.all([source.pickCsv(), loadDiseases(source)]);
			if (!picked.ok) throw new Error(picked.error);
			status.textContent = "";
			if (picked.csv) openForm(picked.csv);
		} catch (err) {
			status.textContent = `could not import: ${err instanceof Error ? err.message : err}`;
			source.log(status.textContent);
		}
	});

	dateSelect.addEventListener("change", updateDateFormat);
	diseaseSelect.addEventListener("change", updatePathogens);
	nameInput.addEventListener("input", () => {
		if (!idEdited) idInput.value = idFromName(nameInput.value);
	});
	idInput.addEventListener("input", () => {
		idEdited = true;
	});
	form.querySelector("#import-cancel")!.addEventListener("click", () => {
		form.hidden = true;
	});

	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		const submit = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
		const from = field<HTMLInputElement>("growthFrom").value;
		const to = field<HTMLInputElement>("growthTo").value;
		if (Boolean(from) !== Boolean(to)) {
			showError("give both dates of the growth window, or neither");
			return;
		}
		submit.disabled = true;
		result.textContent = "checking...";
		try {
			const reply = await source.importCsv(request());
			if (!reply.ok) {
				showError(reply.error, reply.problems);
				return;
			}
			form.hidden = true;
			const unit = { day: "days", week: "weeks", year: "years" }[reply.interval] ?? "rows";
			status.textContent = [`imported ${reply.id}: ${reply.rows} ${unit}.`, ...reply.warnings].join(" ");
			source.log(status.textContent);
			await onImported(reply.id);
		} catch (err) {
			showError(String(err));
		} finally {
			submit.disabled = false;
		}
	});
}
