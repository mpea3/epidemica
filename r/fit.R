# fit.R: called by the app (src/bun/index.ts) through Rscript.
# Prints exactly one JSON object on stdout; anything else goes to stderr.
#
#   Rscript r/fit.R --ping              {"ok":true,"r":"4.5.0"}
#   Rscript r/fit.R --outbreak flu1918  TODO: R0, R(t) and a fitted curve

suppressPackageStartupMessages(library(jsonlite))

args <- commandArgs(trailingOnly = TRUE)

reply <- function(x) {
  cat(toJSON(x, auto_unbox = TRUE, digits = NA), "\n")
}

if ("--ping" %in% args) {
  reply(list(ok = TRUE, r = paste(R.version$major, R.version$minor, sep = ".")))
} else if ("--outbreak" %in% args) {
  id <- args[match("--outbreak", args) + 1]
  # TODO: read data/<id>.json, estimate R(t) with EpiEstim, R0 from early
  # growth, and return them with the fitted curve.
  reply(list(ok = FALSE, outbreak = id, error = "fitting not written yet"))
} else {
  message("usage: fit.R --ping | --outbreak <id>")
  quit(status = 2)
}
