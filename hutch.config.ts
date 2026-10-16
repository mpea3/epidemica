// @hutch cli=0.27.1 cottontail=0.7.1
export default {
	scripts: {
		install: ["hutch", "install", "--frozen-lockfile"],
		start: ["hutch", "electrobun", "dev"],
		dev: ["hutch", "electrobun", "dev", "--watch"],
		build: ["hutch", "electrobun", "build", "--env=stable"],
		typecheck: ["hutch", "pm", "exec", "--", "tsc", "--noEmit"],
		// hutch test needs explicit file paths; a folder finds nothing.
		test: "hutch test $(find src -name '*.test.ts')",
	},
	electrobun: {
		version: "2.0.2",
	},
};
