# common.R: helpers shared by the fetch_*.R scripts. source("r/common.R")
#
# Every dataset is written in one shape so the app can chart any of them:
#
#   {
#     "id": "flu1918",
#     "name": "Influenza, Baltimore 1918",
#     "source": "...", "url": "...", "accessed": "2026-10-16", "licence": "...",
#     "series": [ { "date": "1918-09-01", "cases": 5, "deaths": null }, ... ]
#   }
#
# cases and deaths are new counts per row (day, or week/year where that is all
# the source has; "interval" says which). R(t) is added later by fit.R.

suppressPackageStartupMessages(library(jsonlite))

write_outbreak <- function(id, name, source, url, licence, interval, series) {
  stopifnot(all(c("date", "cases") %in% names(series)))
  out <- list(
    id = id, name = name, source = source, url = url,
    accessed = format(Sys.Date()), licence = licence, interval = interval,
    series = series
  )
  path <- file.path("data", paste0(id, ".json"))
  write_json(out, path, auto_unbox = TRUE, na = "null", digits = NA, pretty = TRUE)
  message("wrote ", path, " (", nrow(series), " rows)")
}
