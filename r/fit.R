# fit.R: called by the app (src/bun/index.ts) through Rscript.
# Prints exactly one JSON object on stdout; anything else goes to stderr.
#
#   Rscript r/fit.R --ping              {"ok":true,"r":"4.5.0"}
#   Rscript r/fit.R --outbreak flu1918  R0, R(t) and simulator parameters:
#
#   {
#     "ok": true, "outbreak": "flu1918",
#     "r0": 1.36, "r0_ci": [1.3, 1.43],
#     "r0_window": ["1918-09-01", "1918-10-10"], "growth_rate": 0.126,
#     "rt": [ { "date": "1918-09-08", "mean": 1.4, "lo": 1.0, "hi": 1.9 }, ... ],
#     "params": { "incubationDays": 1.4, "infectiousDays": 4,
#                 "serialIntervalMean": 2.6, "serialIntervalSd": 1.5 }
#   }
#
# If something goes wrong it prints {"ok": false, "outbreak": ..., "error": ...}.
#
# Method
#   R(t): EpiEstim (Cori et al. 2013, Am J Epidemiol 178: 1505-1512). For
#     each 7-day window, R is the number of new cases divided by how
#     infectious the earlier cases still are, weighted by the serial
#     interval (gamma distribution, mean and SD per disease below).
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

# --- Per-disease values ------------------------------------------------------
# si_mean, si_sd: serial interval in days (time from symptom onset in one
#   case to symptom onset in the person they infect), used for R(t) and R0.
# incubation, infectious: starting values for the simulator dials, in days.
#   The infectious period is the hardest to pin down and is rounded.
# growth_from, growth_to: the early growth window used for R0, chosen by
#   looking at the curve (see r/eda.R): from the start until the curve stops
#   growing exponentially or interventions start.

disease_values <- list(
  flu1918 = list(
    # Serial interval 2.6 (SD 1.5): the one EpiEstim ships with Flu1918
    #   (Ferguson et al. 2005, Nature 437: 209-214).
    # Incubation 1.4 days: influenza A, Lessler et al. 2009, Lancet Infect
    #   Dis 9: 291-300.
    # Infectious about 4 days: virus shedding lasts 4-5 days, Carrat et al.
    #   2008, Am J Epidemiol 167: 775-785.
    si_mean = 2.6, si_sd = 1.5, incubation = 1.4, infectious = 4,
    # 1 September to 10 October, the same window as Fraser et al. 2011
    #   (Am J Epidemiol 174: 505-514), who found R = 1.38 (1.33-1.42) from
    #   this survey. Part of Baltimore was already immune after the spring
    #   1918 wave, so this is below the true R0 (they estimate 1.77 for a
    #   population with no immunity).
    growth_from = "1918-09-01", growth_to = "1918-10-10"
  ),
  measles1861 = list(
    # Serial interval 10.4 (SD 1.7): measured from the 184 child/infector
    #   pairs in the Hagelloch line list itself (prodrome to prodrome; see
    #   r/eda.R). Vink et al. 2014 (Am J Epidemiol 180: 865-875) give
    #   11.7 days for measles in general.
    # Incubation 12.5 days to prodrome: Lessler et al. 2009.
    # Infectious about 8 days: from the prodrome to about 4 days after the
    #   rash appears (the rash comes about 4 days after the prodrome).
    si_mean = 10.4, si_sd = 1.7, incubation = 12.5, infectious = 8,
    # The first child fell ill on 30 Oct; the village school spread it in
    # one big wave in mid-November.
    growth_from = "1861-10-30", growth_to = "1861-11-21"
  ),
  ebola_sl2014 = list(
    # Serial interval 15.3 (SD 9.3) and incubation 11.4 days: WHO Ebola
    #   Response Team 2014, N Engl J Med 371: 1481-1495.
    # Infectious 5.6 days: Chowell et al. 2004, J Theor Biol 229: 119-126.
    si_mean = 15.3, si_sd = 9.3, incubation = 11.4, infectious = 5.6,
    # Growth in Sierra Leone from June to the end of September 2014. The
    # WHO Ebola Response Team found a doubling time of about 30 days for
    # Sierra Leone over this period.
    growth_from = "2014-06-01", growth_to = "2014-09-30"
  ),
  ebola_westafrica = list(
    # Same values as ebola_sl2014.
    si_mean = 15.3, si_sd = 9.3, incubation = 11.4, infectious = 5.6,
    # The series starts in September 2014, already late in the growth phase.
    growth_from = "2014-09-07", growth_to = "2014-10-26"
  ),
  mpox = list(
    # Serial interval 8.5 (SD 5.0): Madewell et al. 2023, Emerg Infect Dis
    #   29: 818-821 (United States, 2022).
    # Incubation 7.6 days: Ward et al. 2022, BMJ 379: e073153 (UK, 2022).
    # Infectious about 21 days: until the skin lesions have healed, which
    #   takes 2-4 weeks (WHO mpox fact sheet).
    si_mean = 8.5, si_sd = 5.0, incubation = 7.6, infectious = 21,
    # Global growth from May until the peak in early August 2022.
    growth_from = "2022-05-08", growth_to = "2022-07-24"
  ),
  covid_nl = list(
    # Serial interval 4.7 (SD 2.9): Nishiura et al. 2020, Int J Infect Dis
    #   93: 284-286.
    # Incubation 5.1 days: Lauer et al. 2020, Ann Intern Med 172: 577-582.
    # Infectious about 7 days: infectiousness peaks around symptom onset
    #   and falls over the following week (He et al. 2020, Nat Med 26:
    #   672-675). Rounded.
    si_mean = 4.7, si_sd = 2.9, incubation = 5.1, infectious = 7,
    # From the first case to the start of the "intelligent lockdown" on
    # 15 March 2020 (schools, cafes and restaurants closed).
    growth_from = "2020-02-28", growth_to = "2020-03-15"
  )
)

# --- Steps -------------------------------------------------------------------

# Where data/ is: next to r/, both in the project folder and in the built app
# (electrobun.config.ts copies r/ and data/ side by side). The app does not
# start Rscript in the project folder, so we look at where this script is.
data_folder <- function() {
  all_args <- commandArgs(trailingOnly = FALSE)
  file_arg <- sub("^--file=", "", all_args[grepl("^--file=", all_args)])
  if (length(file_arg) == 0) return("data")
  file.path(dirname(dirname(normalizePath(file_arg))), "data")
}

read_outbreak <- function(id) {
  if (!grepl("^[a-z0-9_]+$", id)) stop("not an outbreak id: ", id)
  path <- file.path(data_folder(), paste0(id, ".json"))
  if (!file.exists(path)) stop("no dataset ", id, " (looked for ", path, ")")
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
estimate_rt <- function(daily, values) {
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
      mean_si = values$si_mean, std_si = values$si_sd,
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

# R0 from the growth rate in the early growth window.
estimate_r0 <- function(daily, values) {
  in_window <- daily$date >= as.Date(values$growth_from) &
    daily$date <= as.Date(values$growth_to)
  early <- daily[in_window, ]
  early$t <- as.numeric(early$date - min(early$date))

  # log(expected cases) = a + r * t. Real case counts are much noisier
  # than a Poisson distribution allows (weekend dips, people rounding the
  # date they fell ill), so quasipoisson widens the interval to match.
  fit <- glm(round(cases) ~ t, family = quasipoisson, data = early)
  r <- coef(fit)[["t"]]
  r_ci <- confint.default(fit)["t", ]  # Wald 95% interval

  m <- values$si_mean
  s <- values$si_sd
  growth_to_r0 <- function(r) (1 + r * s^2 / m)^(m^2 / s^2)

  list(
    r0 = round(growth_to_r0(r), 3),
    r0_ci = round(growth_to_r0(unname(r_ci)), 3),
    window = c(values$growth_from, values$growth_to),
    growth_rate = round(r, 4)
  )
}

fit_outbreak <- function(id) {
  outbreak <- read_outbreak(id)
  daily <- daily_cases(outbreak)
  values <- disease_values[[id]]
  if (is.null(values)) stop("no serial interval set for ", id, " in fit.R")
  r0 <- estimate_r0(daily, values)
  rt <- estimate_rt(daily, values)
  message(id, ": R0 = ", r0$r0, " (", r0$r0_ci[1], "-", r0$r0_ci[2], "), ",
          nrow(rt), " R(t) values")

  list(
    ok = TRUE,
    outbreak = id,
    r0 = r0$r0,
    r0_ci = r0$r0_ci,
    r0_window = r0$window,
    growth_rate = r0$growth_rate,
    rt = rt,
    params = list(
      incubationDays = values$incubation,
      infectiousDays = values$infectious,
      serialIntervalMean = values$si_mean,
      serialIntervalSd = values$si_sd
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
