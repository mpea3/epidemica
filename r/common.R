# common.R: helpers shared by the fetch_*.R scripts. source("r/common.R")
#
# Every dataset is written in one shape so the app can chart any of them:
#
#   {
#     "id": "flu1918",
#     "name": "Influenza, Baltimore 1918",
#     "source": "...", "url": "...", "accessed": "2026-10-16", "licence": "...",
#     "interval": "day",
#     "notes": "...",                       (optional)
#     "series": [ { "date": "1918-09-01", "cases": 5, "deaths": null }, ... ]
#   }
#
# cases and deaths are new counts per row (day, or week/year where that is all
# the source has; "interval" says which). A series can have extra columns
# (for example vaccinations); the app ignores the ones it does not know.
# When a dataset joins several sources, source, url and licence list them in
# the same order, separated by "; ". R(t) is added later by fit.R.

suppressPackageStartupMessages(library(jsonlite))

# Big downloads (RIVM files are about 30 MB) need more than R's default 60 s.
options(timeout = 600)

write_outbreak <- function(id, name, source, url, licence, interval, series,
                           notes = NULL) {
  stopifnot(all(c("date", "cases") %in% names(series)))
  series$date <- format(series$date)
  out <- list(
    id = id, name = name, source = source, url = url,
    accessed = format(Sys.Date()), licence = licence, interval = interval
  )
  if (!is.null(notes)) out$notes <- notes
  out$series <- series
  path <- file.path("data", paste0(id, ".json"))
  write_json(out, path, auto_unbox = TRUE, na = "null", digits = NA, pretty = TRUE)
  message("wrote ", path, " (", nrow(series), " rows)")
}

# Downloads url to data/raw/<file> once and returns the local path. Delete
# the file in data/raw/ to download a fresh copy.
download_raw <- function(url, file) {
  dir.create(file.path("data", "raw"), recursive = TRUE, showWarnings = FALSE)
  path <- file.path("data", "raw", file)
  if (file.exists(path)) {
    message("using ", path, " (delete it to download again)")
  } else {
    message("downloading ", url)
    download.file(url, path, mode = "wb", quiet = TRUE)
  }
  path
}

# Counts events per day from a vector of dates, including the days with no
# events, from the first to the last date. Missing dates are dropped.
count_per_day <- function(dates, from = min(dates, na.rm = TRUE),
                          to = max(dates, na.rm = TRUE)) {
  days <- seq(from, to, by = "day")
  dates <- dates[!is.na(dates)]
  counts <- table(factor(format(dates), levels = format(days)))
  data.frame(date = days, n = as.integer(counts))
}
