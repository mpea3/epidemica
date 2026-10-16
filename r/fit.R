# fit.R: called by the app (src/bun/index.ts) through Rscript.
# Prints exactly one JSON object on stdout; anything else goes to stderr.
#
#   Rscript r/fit.R --ping              {"ok":true,"r":"4.5.0"}
#   Rscript r/fit.R --outbreak flu1918  R0, R(t) and simulator parameters:
#
#   {
#     "ok": true, "outbreak": "flu1918", "disease": "Influenza",
#     "r0": 1.33, "r0_ci": [1.26, 1.4],
#     "r0_window": ["1918-09-01", "1918-10-10"], "r0_window_auto": false,
#     "growth_rate": 0.126,
#     "rt": [ { "date": "1918-09-08", "mean": 1.4, "lo": 1.0, "hi": 1.9 }, ... ],
#     "params": { "incubationDays": 1.46, "infectiousDays": 4,
#                 "serialIntervalMean": 2.51, "serialIntervalSd": 1.55 },
#     "sources": { "serialInterval": "Ghani et al. 2009, doi:... (epiparameter, ...)",
#                  "incubation": "...", "infectious": "Carrat et al. 2008" }
#   }
#
# Serial interval, incubation and infectious period come from
# r/parameters.R (epiparameter). incubationDays or infectiousDays is null
# when neither epiparameter nor the fallbacks there know it.
#
# If something goes wrong it prints {"ok": false, "outbreak": ..., "error": ...}.
#
# Method
#   R(t): EpiEstim (Cori et al. 2013, Am J Epidemiol 178: 1505-1512). For
#     each 7-day window, R is the number of new cases divided by how
#     infectious the earlier cases still are, weighted by the serial
#     interval (a gamma distribution with the mean and SD of the
#     epiparameter estimate, whatever shape that estimate has).
#   R0: from the growth rate r in the first weeks, before people changed
#     their behaviour. r comes from a regression of daily cases on time,
#     log(expected cases) = a + r * t (a quasi-Poisson GLM: Poisson, but the
#     interval allows for counts that vary more than Poisson counts do). With a gamma generation interval of mean
#     m and SD s, Wallinga and Lipsitch (2007, Proc R Soc B 274: 599-604)
#     give R0 = (1 + r * s^2 / m) ^ (m^2 / s^2). We use the serial interval
#     in place of the generation interval, which is the usual shortcut.

suppressPackageStartupMessages(library(jsonlite))

args <- commandArgs(trailingOnly = TRUE)

reply <- function(x) {
  cat(toJSON(x, auto_unbox = TRUE, digits = NA), "\n")
}

# --- Per-outbreak settings ---------------------------------------------------
# Serial intervals, incubation and infectious periods are per disease and
# come from r/parameters.R (epiparameter, with a few fallbacks). What is left
# here is per outbreak:
#   disease, pathogen: the names epiparameter uses.
#   growth_window: the early growth used for R0, chosen by looking at the
#     curve (see r/eda.R): from the start until the curve stops growing
#     exponentially or interventions start.
# An imported dataset (r/import.R) carries the same fields in its JSON
# instead. Without a growth_window, R0 uses the first wave (auto_window()).

builtin_outbreaks <- list(
  flu1918 = list(
    disease = "Influenza", pathogen = "Influenza-A-H1N1",
    # 1 September to 10 October, the same window as Fraser et al. 2011
    #   (Am J Epidemiol 174: 505-514), who found R = 1.38 (1.33-1.42) from
    #   this survey. Part of Baltimore was already immune after the spring
    #   1918 wave, so this is below the true R0 (they estimate 1.77 for a
    #   population with no immunity).
    growth_window = c("1918-09-01", "1918-10-10")
  ),
  measles1861 = list(
    disease = "Measles",
    # The outbreak moves in generations about 10 days apart (a few cases,
    # then a jump when the school spread it on 20-22 Nov, then a bigger jump
    # on 30 Nov - 1 Dec). A window that ends inside a jump gives anything
    # from R0 = 3 to 14, so we use the first month, from the first child
    # (30 Oct) to 30 Nov: three whole generations. Read it as rough.
    growth_window = c("1861-10-30", "1861-11-30")
  ),
  ebola_sl2014 = list(
    disease = "Ebola Virus Disease",
    # Growth in Sierra Leone from June to the end of September 2014. The
    # WHO Ebola Response Team found a doubling time of about 30 days for
    # Sierra Leone over this period.
    growth_window = c("2014-06-01", "2014-09-30")
  ),
  ebola_westafrica = list(
    disease = "Ebola Virus Disease",
    # The series starts in September 2014, already late in the growth phase.
    growth_window = c("2014-09-07", "2014-10-26")
  ),
  mpox = list(
    disease = "Mpox",
    # Global growth from May until the peak in early August 2022.
    growth_window = c("2022-05-08", "2022-07-24")
  ),
  covid_nl = list(
    disease = "COVID-19",
    # From the first case to the start of the "intelligent lockdown" on
    # 15 March 2020 (schools, cafes and restaurants closed).
    growth_window = c("2020-02-28", "2020-03-15")
  )
)

# --- Steps -------------------------------------------------------------------

# Where r/ is: in the project folder and in the built app alike
# (electrobun.config.ts copies r/ and data/ side by side). The app does not
# start Rscript in the project folder, so we look at where this script is.
script_folder <- function() {
  all_args <- commandArgs(trailingOnly = FALSE)
  file_arg <- sub("^--file=", "", all_args[grepl("^--file=", all_args)])
  if (length(file_arg) == 0) return("r")
  dirname(normalizePath(file_arg))
}

# Where datasets are: data/ next to r/, then the folder the app keeps
# imported datasets in, which it passes as EPIDEMICA_USER_DATA.
data_folders <- function() {
  user <- Sys.getenv("EPIDEMICA_USER_DATA")
  c(file.path(dirname(script_folder()), "data"), if (nzchar(user)) user)
}

read_outbreak <- function(id) {
  if (!grepl("^[a-z0-9_]+$", id)) stop("not an outbreak id: ", id)
  paths <- file.path(data_folders(), paste0(id, ".json"))
  path <- paths[file.exists(paths)][1]
  if (is.na(path)) {
    stop("no dataset ", id, " (looked in ", paste(dirname(paths), collapse = ", "), ")")
  }
  outbreak <- fromJSON(path)
  outbreak$series$date <- as.Date(outbreak$series$date)
  outbreak
}

# EpiEstim needs one count per day with no gaps.
#   - Leading and trailing days without a count (null) are dropped. COVID-19
#     cases, for example, stop in March 2023 but the wastewater goes on.
#   - A null in the middle (an Ebola week where the running total went down)
#     becomes 0.
#   - A weekly count is spread evenly over the 7 days that end on its date.
#     The CRAN version of EpiEstim (2.2-5) cannot take weekly data directly.
daily_cases <- function(outbreak) {
  s <- outbreak$series
  has_count <- which(!is.na(s$cases))
  s <- s[min(has_count):max(has_count), ]
  s$cases[is.na(s$cases)] <- 0

  if (outbreak$interval == "day") {
    return(data.frame(date = s$date, cases = s$cases))
  }
  if (outbreak$interval == "week") {
    days <- seq(min(s$date) - 6, max(s$date), by = "day")
    cases <- rep(s$cases / 7, each = 7)
    return(data.frame(date = days, cases = cases))
  }
  stop(outbreak$id, " has one count per ", outbreak$interval,
       "; R(t) needs daily or weekly counts")
}

# R(t) over sliding 7-day windows. Each estimate is dated on the last day of
# its window. Windows with fewer than 12 cases are left out: the posterior
# for R is a gamma distribution whose shape is about the number of cases in
# the window, so its coefficient of variation is about 1 / sqrt(cases), and
# 12 cases gives about 0.3 (Cori et al. 2013 use the same rule of thumb).
estimate_rt <- function(daily, si) {
  suppressPackageStartupMessages(library(EpiEstim))
  n <- nrow(daily)
  window <- 7
  t_start <- 2:(n - window + 1)
  t_end <- t_start + window - 1

  # EpiEstim warns about estimating R early in the epidemic; we filter those
  # windows out below, so the warning only goes to stderr.
  result <- estimate_R(
    incid = round(daily$cases),
    method = "parametric_si",
    config = make_config(list(
      mean_si = si$mean, std_si = si$sd,
      t_start = t_start, t_end = t_end
    ))
  )

  r <- result$R
  cases_in_window <- sapply(seq_len(nrow(r)), function(i) {
    sum(daily$cases[r$t_start[i]:r$t_end[i]])
  })
  # EpiEstim also gives NA when the earlier cases are too far back to
  # count yet (the start of a long serial interval, as with Ebola).
  keep <- cases_in_window >= 12 & !is.na(r[["Mean(R)"]])

  data.frame(
    date = format(daily$date[r$t_end[keep]]),
    mean = round(r[["Mean(R)"]][keep], 3),
    lo = round(r[["Quantile.0.025(R)"]][keep], 3),
    hi = round(r[["Quantile.0.975(R)"]][keep], 3)
  )
}

# The first wave, for datasets without a hand-picked growth window: from the
# first case to the highest point of the 7-day average before the wave is
# over, which is when that average has stayed below half the highest point
# for 14 days (a single quiet stretch or reporting dip is not the end).
# On the built-in outbreaks this gives R0 within about 10% of the
# hand-picked windows, except COVID-19 in the Netherlands, whose lockdown
# came before the peak (1.37 against 2.54). So read it as rough; r/eda.R
# draws the window, and a hand-picked growth_window in the JSON is better.
auto_window <- function(daily) {
  smooth <- as.numeric(stats::filter(daily$cases, rep(1 / 7, 7), sides = 2))
  smooth[is.na(smooth)] <- daily$cases[is.na(smooth)]
  start <- which(daily$cases > 0)[1]
  if (is.na(start)) stop("there are no cases to estimate R0 from")
  peak <- start
  quiet_days <- 0
  for (i in start:length(smooth)) {
    if (smooth[i] > smooth[peak]) peak <- i
    quiet_days <- if (smooth[i] < smooth[peak] / 2) quiet_days + 1 else 0
    if (quiet_days >= 14) break
  }
  format(daily$date[c(start, peak)])
}

# R0 from the growth rate in the early growth window.
estimate_r0 <- function(daily, si, window) {
  in_window <- daily$date >= as.Date(window[1]) & daily$date <= as.Date(window[2])
  early <- daily[in_window, ]
  if (nrow(early) < 5) {
    stop("the growth window ", window[1], " to ", window[2], " has ",
         nrow(early), " days; R0 needs at least 5")
  }
  early$t <- as.numeric(early$date - min(early$date))

  # log(expected cases) = a + r * t. Real case counts are much noisier
  # than a Poisson distribution allows (weekend dips, people rounding the
  # date they fell ill), so quasipoisson widens the interval to match.
  fit <- glm(round(cases) ~ t, family = quasipoisson, data = early)
  r <- coef(fit)[["t"]]
  r_ci <- confint.default(fit)["t", ]  # Wald 95% interval

  m <- si$mean
  s <- si$sd
  growth_to_r0 <- function(r) (1 + r * s^2 / m)^(m^2 / s^2)

  list(
    r0 = round(growth_to_r0(r), 3),
    r0_ci = round(growth_to_r0(unname(r_ci)), 3),
    window = window,
    growth_rate = round(r, 4)
  )
}

# Disease and growth window: from the dataset itself if it says (imported
# datasets do), otherwise from builtin_outbreaks above.
outbreak_settings <- function(outbreak) {
  if (!is.null(outbreak$disease)) {
    return(list(disease = outbreak$disease, pathogen = outbreak$pathogen,
                growth_window = outbreak$growth_window))
  }
  settings <- builtin_outbreaks[[outbreak$id]]
  if (is.null(settings)) {
    stop(outbreak$id, " does not say which disease it is; add \"disease\" to ",
         "its JSON (see r/import.R) or an entry to builtin_outbreaks in fit.R")
  }
  settings
}

fit_outbreak <- function(id) {
  source(file.path(script_folder(), "parameters.R"))
  outbreak <- read_outbreak(id)
  daily <- daily_cases(outbreak)
  settings <- outbreak_settings(outbreak)
  p <- disease_parameters(settings$disease, settings$pathogen)
  window <- settings$growth_window %||% auto_window(daily)

  r0 <- estimate_r0(daily, p$serial_interval, window)
  rt <- estimate_rt(daily, p$serial_interval)
  message(id, ": R0 = ", r0$r0, " (", r0$r0_ci[1], "-", r0$r0_ci[2], "), ",
          nrow(rt), " R(t) values")

  list(
    ok = TRUE,
    outbreak = id,
    disease = p$disease,
    r0 = r0$r0,
    r0_ci = r0$r0_ci,
    r0_window = r0$window,
    r0_window_auto = is.null(settings$growth_window),
    growth_rate = r0$growth_rate,
    rt = rt,
    # null where nothing is known; the app then leaves that dial alone.
    params = list(
      incubationDays = p$incubation$mean,
      infectiousDays = p$infectious$mean,
      serialIntervalMean = p$serial_interval$mean,
      serialIntervalSd = p$serial_interval$sd
    ),
    sources = list(
      serialInterval = p$serial_interval$source,
      incubation = p$incubation$source,
      infectious = p$infectious$source
    )
  )
}

# --- Main --------------------------------------------------------------------

if ("--ping" %in% args) {
  reply(list(ok = TRUE, r = paste(R.version$major, R.version$minor, sep = ".")))
} else if ("--outbreak" %in% args) {
  id <- args[match("--outbreak", args) + 1]
  result <- tryCatch(
    fit_outbreak(id),
    error = function(e) list(ok = FALSE, outbreak = id, error = conditionMessage(e))
  )
  reply(result)
} else {
  message("usage: fit.R --ping | --outbreak <id>")
  quit(status = 2)
}
