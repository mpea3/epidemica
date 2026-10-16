// Runs `hutch test` once per *.test.ts file under src/.
// Cottontail's bun:test runs 0 tests and exits 0 when given more than one
// file, so passing them all at once would hide every failure.
import { readdirSync } from "node:fs";
import { join } from "node:path";

const testFiles = readdirSync("src", { recursive: true })
	.map((entry) => join("src", String(entry)))
	.filter((path) => path.endsWith(".test.ts"))
	.sort();

if (testFiles.length === 0) {
	console.error("No *.test.ts files found under src/.");
	process.exit(1);
}

for (const file of testFiles) {
	console.log(`\n== ${file}`);
	const result = Bun.spawnSync(["hutch", "test", file], {
		stdout: "inherit",
		stderr: "inherit",
	});
	if (result.exitCode !== 0) {
		console.error(`\n${file} failed (exit code ${result.exitCode}).`);
		process.exit(result.exitCode ?? 1);
	}
}

console.log(`\nAll test files passed (${testFiles.length}).`);
