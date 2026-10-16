# import.R: turns a CSV of your own into data/<id>.json, the shape every
# dataset in the app has (see r/common.R). The app runs it from the History
# tab's import button; it works the same from a terminal. Prints one JSON
# object on stdout, like fit.R; messages go to stderr.
#
#   Rscript r/import.R --inspect cases.csv
#       Column names, the first rows and a guess at which column is which:
#       {"ok": true, "columns": [...], "rows": [[...], ...], "delimiter": ",",
#        "guess": {"date": "Datum", "cases": "n", "deaths": null}}
#
#   Rscript r/import.R --diseases
#       The diseases a dataset can be tagged with (from epiparameter):
#       {"ok": true, "diseases": [{"disease": "COVID-19",
#        "pathogens": ["SARS-CoV-2"], "canFit": true}, ...]}
#
#   Rscript r/import.R --csv cases.csv --id my_flu --name "Flu, my town 2025" \
#       --date Datum --cases n [--deaths d] --disease Influenza \
#       [--pathogen Influenza-A-H1N1] [--date-format %d/%m/%Y] \
#       [--delimiter ";"] [--source ...] [--url ...] [--licence ...] \
#       [--growth-from 2025-01-03 --growth-to 2025-02-01] [--out folder] [--force]
#       {"ok": true, "id": "my_flu", "path": ".../my_flu.json", "rows": 92,
#        "interval": "day", "from": "...", "to": "...", "warnings": [...]}
#
# Tagging. You say which column is which, the way the linelist package tags
# columns: --date, --cases and --deaths name a column in your CSV. The
# other columns are kept out of the JSON. Leave out --cases for a line list
# (one row per case): the rows are then counted per date.
#
# Checking. r/import-schema.json is a Frictionless Table Schema for the
# tagged columns: a date, and whole numbers of at least 0. import.R names
# its fields after your columns and reads the CSV with the frictionless
# package, which reports every value that is not the right type. frictionless
# does not check constraints, so check_constraints() below does that, from
# the same schema. If anything fails, nothing is written and the reply lists
# the problems with their line numbers in the CSV.
#
# Where it writes. --out, or data/ next to this script. The app passes its
# own folder for imported datasets, so imports survive a rebuild.

suppressPackageStartupMessages({
  library(jsonlite)
  library(frictionless)
})

args <- commandArgs(trailingOnly = TRUE)

reply <- function(x) {
  cat(toJSON(x, auto_unbox = TRUE, digits = NA, null = "null", na = "null"), "\n")
}

# The value after --name, or default when it is not given.
arg <- function(name, default = NULL) {
  i <- match(paste0("--", name), args)
  if (is.na(i)) return(default)
  if (i == length(args)) stop("--", name, " needs a value")
  args[i + 1]
}

script_folder <- function() {
  all_args <- commandArgs(trailingOnly = FALSE)
  file_arg <- sub("^--file=", "", all_args[grepl("^--file=", all_args)])
  if (length(file_arg) == 0) return("r")
  dirname(normalizePath(file_arg))
}

source(file.path(script_folder(), "common.R"))

# A CSV problem the user can fix: carried to the reply as a list of lines.
csv_problems <- function(problems) {
  structure(class = c("csv_problems", "error", "condition"), list(
    message = paste(length(problems), "problem(s) in the CSV"),
    problems = problems
  ))
}

# --- Reading -----------------------------------------------------------------

# , or ; or tab, whichever the header line has most of. RIVM and other
# European sources often use ; because , is their decimal point.
guess_delimiter <- function(path) {
  header <- readLines(path, n = 1, warn = FALSE)
  if (length(header) == 0) stop("the CSV is empty")
  counts <- sapply(c(",", ";", "\t"), function(d) lengths(regmatches(header, gregexpr(d, header, fixed = TRUE))))
  names(which.max(counts))
}

# Every value as text, exactly as in the file. Used for the preview and to
# tell a missing value from one that is there but not a number.
read_raw <- function(path, delim, n_max = Inf) {
  readr::read_delim(path, delim = delim, col_types = readr::cols(.default = "c"),
                    na = character(), n_max = n_max, progress = FALSE,
                    show_col_types = FALSE, name_repair = "minimal")
}

# Which column is probably which, from the names. Running totals ("total",
# "cumulative") are skipped: the app wants new counts.
guess_tags <- function(columns) {
  lower <- tolower(columns)
  total <- grepl("total|totaal|cumul|running|sum", lower)
  pick <- function(pattern) {
    hit <- which(grepl(pattern, lower) & !total)
    if (length(hit) == 0) NULL else columns[hit[1]]
  }
  list(
    date = pick("date|datum|^day$|^dag$|^week$|^time$"),
    cases = pick("case|confirmed|incidence|besmet|^n$|^count$"),
    deaths = pick("death|died|overl|fatal")
  )
}

inspect <- function(path) {
  if (!file.exists(path)) stop("no such file: ", path)
  delim <- guess_delimiter(path)
  raw <- read_raw(path, delim, n_max = 5)
  list(
    ok = TRUE,
    path = normalizePath(path),
    delimiter = delim,
    columns = I(names(raw)),
    rows = unname(lapply(seq_len(nrow(raw)), function(i) I(unname(unlist(raw[i, ]))))),
    guess = guess_tags(names(raw))
  )
}

# --- The schema --------------------------------------------------------------

# r/import-schema.json with its fields renamed to the tagged columns, the
# date format filled in, and a string field for every other column
# (frictionless wants a field for every column in the file).
build_schema <- function(columns, tags, date_format, line_list) {
  template <- fromJSON(file.path(script_folder(), "import-schema.json"),
                       simplifyVector = FALSE)
  by_tag <- setNames(template$fields, vapply(template$fields, `[[`, "", "name"))

  fields <- lapply(columns, function(column) {
    tag <- names(tags)[match(column, tags)]
    if (is.na(tag)) return(list(name = column, type = "string"))
    field <- by_tag[[tag]]
    field$tag <- tag
    field$name <- column
    if (tag == "date") {
      field$format <- date_format
      # A line list has one row per case, so dates repeat.
      if (line_list) field$constraints$unique <- NULL
    }
    field
  })
  list(fields = fields, missingValues = template$missingValues)
}

# The constraints frictionless reads but does not check: required, unique,
# minimum, and that an integer is a whole number (frictionless reads
# integers as doubles, so 4.5 gets through).
check_constraints <- function(typed, raw, schema) {
  rows <- integer()
  problems <- character()
  add <- function(i, text) {
    rows <<- c(rows, i)
    problems <<- c(problems, text)
  }
  missing <- unlist(schema$missingValues)
  line <- function(i) i + 1  # the header is line 1
  for (field in schema$fields) {
    if (is.null(field$tag)) next
    column <- field$name
    values <- typed[[column]]
    absent <- raw[[column]] %in% missing
    rules <- field$constraints %||% list()

    if (isTRUE(rules$required)) {
      for (i in which(absent)) {
        add(i, sprintf("line %d: no %s (%s)", line(i), field$tag, column))
      }
    }
    if (isTRUE(rules$unique)) {
      for (i in which(duplicated(values) & !is.na(values))) {
        add(i, sprintf("line %d: %s %s appears more than once",
                       line(i), column, format(values[i])))
      }
    }
    if (field$type == "integer") {
      for (i in which(!is.na(values) & values != round(values))) {
        add(i, sprintf("line %d: %s is %s, not a whole number",
                       line(i), column, raw[[column]][i]))
      }
    }
    if (!is.null(rules$minimum)) {
      for (i in which(!is.na(values) & values < rules$minimum)) {
        add(i, sprintf("line %d: %s is %s, below %s",
                       line(i), column, raw[[column]][i], rules$minimum))
      }
    }
  }
  data.frame(row = rows, text = problems)
}

# Reads the tagged columns through frictionless, typed by the schema, and
# stops with every problem found.
read_checked <- function(path, delim, schema) {
  tagged <- Filter(function(f) !is.null(f$tag), schema$fields)
  columns <- vapply(tagged, `[[`, "", "name")

  package <- add_resource(create_package(), "import", data = path,
                          schema = schema, delim = delim)
  typed <- suppressWarnings(read_resource(package, "import", col_select = tidyselect::all_of(columns)))
  raw <- read_raw(path, delim)[columns]

  # Values frictionless could not read as their type ("abc" for an integer,
  # 05/01/2020 for an ISO date). problems() numbers columns as in the file.
  bad <- problems(typed)
  file_fields <- schema$fields[bad$col]
  expected <- vapply(file_fields, function(f) {
    if (f$type == "date") paste("a date like", format(as.Date("2020-03-31"), f$format))
    else "a whole number"
  }, "")
  type_problems <- data.frame(
    row = bad$row,
    text = sprintf("line %d: %s is \"%s\", expected %s", bad$row + 1,
                   vapply(file_fields, `[[`, "", "name"), bad$actual, expected)
  )

  found <- rbind(type_problems, check_constraints(typed, raw, schema))
  all <- found$text[order(found$row)]
  if (length(all) > 0) stop(csv_problems(all))
  typed
}

# --- Into the app's shape ----------------------------------------------------

# One row per day, week or year with no gaps, so the chart's time axis and
# fit.R's daily counts line up. A date the CSV has no row for gets null:
# no count, which is not the same as 0.
regular_series <- function(series) {
  series <- series[order(series$date), ]
  dates <- series$date
  if (length(dates) < 2) stop("the CSV has fewer than 2 dates")
  gaps <- as.numeric(diff(dates))
  same_day_of_year <- length(unique(format(dates, "%m-%d"))) == 1

  if (min(gaps) == 1) {
    interval <- "day"
    all_dates <- seq(min(dates), max(dates), by = "day")
  } else if (min(gaps) >= 7 && all(gaps %% 7 == 0)) {
    interval <- "week"
    all_dates <- seq(min(dates), max(dates), by = "week")
  } else if (same_day_of_year && min(gaps) >= 365) {
    interval <- "year"
    all_dates <- seq(min(dates), max(dates), by = "year")
  } else {
    stop("the dates are not one per day, week or year (the closest two are ",
         min(gaps), " days apart)")
  }

  filled <- data.frame(date = all_dates)
  filled <- merge(filled, series, by = "date", all.x = TRUE)
  list(series = filled, interval = interval)
}

import_csv <- function() {
  path <- arg("csv")
  id <- arg("id")
  if (is.null(path) || is.null(id)) stop("--csv and --id are needed")
  if (!file.exists(path)) stop("no such file: ", path)
  if (!grepl("^[a-z0-9_]+$", id)) {
    stop("the id may only have lower-case letters, digits and _ (it becomes the file name): ", id)
  }

  if (is.null(arg("date"))) stop("--date is needed: which column has the dates?")
  # Tag -> column, for the tags that were given.
  tags <- c(date = arg("date"), cases = arg("cases"), deaths = arg("deaths"))
  if (anyDuplicated(tags)) stop("one column is tagged twice: ", paste(tags[duplicated(tags)], collapse = ", "))
  line_list <- is.null(arg("cases"))

  delim <- arg("delimiter", guess_delimiter(path))
  columns <- names(read_raw(path, delim, n_max = 0))
  unknown <- setdiff(tags, columns)
  if (length(unknown) > 0) {
    stop("no column called ", paste0("\"", unknown, "\"", collapse = ", "),
         " in the CSV; it has ", paste0("\"", columns, "\"", collapse = ", "))
  }

  # Disease: checked against epiparameter now, so fit.R will not fail later
  # on a name it does not know.
  source(file.path(script_folder(), "parameters.R"))
  disease <- arg("disease")
  pathogen <- arg("pathogen")
  if (is.null(disease)) stop("--disease is needed (see --diseases for the names)")
  diseases <- known_diseases()
  known <- Filter(function(d) d$disease == disease, diseases)
  if (length(known) == 0) {
    stop("epiparameter does not know the disease \"", disease, "\"; see --diseases")
  }
  if (!is.null(pathogen) && !pathogen %in% known[[1]]$pathogens) {
    stop("epiparameter has no pathogen \"", pathogen, "\" for ", disease, "; it has ",
         paste(known[[1]]$pathogens, collapse = ", "))
  }

  # Growth window: both dates or neither.
  growth <- c(arg("growth-from"), arg("growth-to"))
  if (length(growth) == 1) stop("give both --growth-from and --growth-to, or neither")
  if (length(growth) == 2 && anyNA(as.Date(growth, optional = TRUE))) {
    stop("--growth-from and --growth-to are dates like 2020-03-01")
  }

  # Where to write, and an id nobody else has.
  bundled <- file.path(dirname(script_folder()), "data")
  out <- arg("out", bundled)
  target <- file.path(out, paste0(id, ".json"))
  if (normalizePath(out, mustWork = FALSE) != normalizePath(bundled) &&
      file.exists(file.path(bundled, paste0(id, ".json")))) {
    stop("a built-in dataset is already called ", id, "; pick another id")
  }
  if (file.exists(target) && !"--force" %in% args) {
    stop("there is already a dataset called ", id, " (", target, "); pick another id or pass --force")
  }

  schema <- build_schema(columns, tags, arg("date-format", "%Y-%m-%d"), line_list)
  typed <- read_checked(path, delim, schema)

  if (line_list) {
    counted <- count_per_day(typed[[tags[["date"]]]])
    series <- data.frame(date = counted$date, cases = counted$n)
    regular <- list(series = series, interval = "day")
  } else {
    series <- data.frame(date = typed[[tags[["date"]]]], cases = typed[[tags[["cases"]]]])
    if (!is.null(arg("deaths"))) series$deaths <- typed[[tags[["deaths"]]]]
    regular <- regular_series(series)
  }
  series <- regular$series

  if (length(growth) == 2) {
    span <- range(series$date)
    if (as.Date(growth[1]) < span[1] || as.Date(growth[2]) > span[2] || growth[1] >= growth[2]) {
      stop("the growth window must be inside the data, ", span[1], " to ", span[2])
    }
  }

  # Things that are allowed but probably not what was meant.
  warnings <- character()
  cases <- series$cases[!is.na(series$cases)]
  if (length(cases) > 10 && all(diff(cases) >= 0) && max(cases) > 0) {
    warnings <- c(warnings, "cases never go down: is this a running total? The app wants new cases per date.")
  }
  if (!known[[1]]$canFit) {
    warnings <- c(warnings, paste("epiparameter has no serial interval for", disease,
                                  "so the app cannot estimate R0 or R(t) for it"))
  }
  added <- sum(!series$date %in% typed[[tags[["date"]]]])
  if (!line_list && added > 0) {
    warnings <- c(warnings, sprintf("%d %s had no row in the CSV and are left empty (no count, not 0)",
                                    added, paste0(regular$interval, "s")))
  }

  tag_note <- paste(sprintf("%s = %s", names(tags), tags), collapse = ", ")
  written <- write_outbreak(
    id = id,
    name = arg("name", id),
    source = arg("source", paste("imported from", basename(path))),
    url = arg("url", ""),
    licence = arg("licence", "unknown"),
    interval = regular$interval,
    series = series,
    notes = paste0("Imported with r/import.R from ", basename(path), " (",
                   if (line_list) "line list, one row per case; " else "",
                   "columns: ", tag_note, ")."),
    disease = disease,
    pathogen = pathogen,
    growth_window = if (length(growth) == 2) growth,
    folder = out
  )

  list(
    ok = TRUE, id = id, path = normalizePath(written), rows = nrow(series),
    interval = regular$interval,
    from = format(min(series$date)), to = format(max(series$date)),
    warnings = I(warnings)
  )
}

# --- Main --------------------------------------------------------------------

failed <- function(e) {
  out <- list(ok = FALSE, error = conditionMessage(e))
  if (inherits(e, "csv_problems")) {
    shown <- head(e$problems, 20)
    if (length(e$problems) > 20) shown <- c(shown, sprintf("... and %d more", length(e$problems) - 20))
    out$problems <- I(shown)
  }
  out
}

if ("--inspect" %in% args) {
  reply(tryCatch(inspect(arg("inspect")), error = failed))
} else if ("--diseases" %in% args) {
  reply(tryCatch({
    source(file.path(script_folder(), "parameters.R"))
    list(ok = TRUE, diseases = known_diseases())
  }, error = failed))
} else if ("--csv" %in% args) {
  reply(tryCatch(import_csv(), error = failed))
} else {
  message("usage: import.R --inspect <csv> | --diseases | --csv <csv> --id <id> --date <column> ...")
  quit(status = 2)
}
