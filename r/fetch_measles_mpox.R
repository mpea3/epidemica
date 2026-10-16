# fetch_measles_mpox.R: measles (two datasets) and mpox.
#
# Sources (all accessed 2026-10-16):
#   outbreaks::measles_hagelloch_1861 (outbreaks 1.9.0): line list of 188
#     cases in the village of Hagelloch, Germany, 1861 (one row per child).
#     https://cran.r-project.org/package=outbreaks   Licence: GPL (>= 2)
#   Our World in Data, reported measles cases per year, from the WHO Global
#     Health Observatory (World total, 1980-2024).
#     https://ourworldindata.org/grapher/reported-cases-of-measles.csv
#     Licence: CC BY-NC-SA 4.0 (WHO data), OWID processing CC BY 4.0
#   Our World in Data, mpox confirmed cases and deaths per day, from WHO
#     (World total, since May 2022).
#     https://catalog.ourworldindata.org/garden/who/latest/monkeypox/monkeypox.csv
#     Licence: CC BY 4.0
#     The old GitHub repo (github.com/owid/monkeypox) is no longer what OWID
#     uses; its README points to the OWID catalog, so we read that instead.
#
# Writes: data/measles1861.json (day), data/measles_world.json (year),
#         data/mpox.json (day)
#
# Raw downloads go in data/raw/ (not committed).
# Run from the project folder: Rscript r/fetch_measles_mpox.R

source("r/common.R")
suppressPackageStartupMessages(library(outbreaks))

# --- Measles, Hagelloch 1861 -------------------------------------------------
# Onset is the date of the prodrome (fever, cough), not the rash. The
# prodrome comes about 4 days before the rash and is when a child starts to
# be infectious, so it is the better date for transmission.

hagelloch <- outbreaks::measles_hagelloch_1861

first_day <- min(hagelloch$date_of_prodrome)
last_day <- max(c(hagelloch$date_of_prodrome, hagelloch$date_of_death), na.rm = TRUE)

cases <- count_per_day(hagelloch$date_of_prodrome, first_day, last_day)
deaths <- count_per_day(hagelloch$date_of_death, first_day, last_day)

write_outbreak(
  id = "measles1861",
  name = "Measles, Hagelloch 1861",
  source = "outbreaks::measles_hagelloch_1861 (Pfeilsticker 1863, Oesterle 1992)",
  url = "https://cran.r-project.org/package=outbreaks",
  licence = "GPL (>= 2) (outbreaks package)",
  interval = "day",
  notes = "Cases by date of prodrome (first symptoms). 188 children, 12 deaths.",
  series = data.frame(date = cases$date, cases = cases$n, deaths = deaths$n)
)

# --- Measles, world, per year ------------------------------------------------

measles_url <- "https://ourworldindata.org/grapher/reported-cases-of-measles.csv"
measles_raw <- read.csv(download_raw(measles_url, "measles_owid.csv"), check.names = FALSE)

world <- measles_raw[measles_raw$Entity == "World", ]
world <- world[order(world$Year), ]

write_outbreak(
  id = "measles_world",
  name = "Measles, reported cases worldwide",
  source = "WHO Global Health Observatory, via Our World in Data",
  url = measles_url,
  licence = "CC BY-NC-SA 4.0 (WHO); CC BY 4.0 (Our World in Data)",
  interval = "year",
  notes = "One row per year; the date is 1 January of that year. Reported cases only, so far below the true number.",
  series = data.frame(
    date = as.Date(paste0(world$Year, "-01-01")),
    cases = world[["Measles - number of reported cases"]],
    deaths = NA
  )
)

# --- Mpox, world, per day ----------------------------------------------------
# Many countries report to WHO once a week, so the daily series is spiky.
# The 7-day average from OWID is kept as an extra column for charts.

mpox_url <- "https://catalog.ourworldindata.org/garden/who/latest/monkeypox/monkeypox.csv"
mpox_raw <- read.csv(download_raw(mpox_url, "mpox_owid.csv"))

mpox <- mpox_raw[mpox_raw$country == "World", ]
mpox <- mpox[order(mpox$date), ]

write_outbreak(
  id = "mpox",
  name = "Mpox, confirmed cases worldwide",
  source = "WHO, via Our World in Data",
  url = mpox_url,
  licence = "CC BY 4.0",
  interval = "day",
  notes = "Confirmed cases by date of report. Many countries report weekly, so daily counts are spiky; cases_7day is the 7-day average.",
  series = data.frame(
    date = as.Date(mpox$date),
    cases = mpox$new_cases,
    deaths = mpox$new_deaths,
    cases_7day = mpox$new_cases_smoothed
  )
)
