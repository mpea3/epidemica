# fetch_covid_nl.R: COVID-19 in the Netherlands.
#
# Sources (all accessed 2026-10-16):
#   RIVM, positive tests and deaths per municipality per publication date,
#     27 Feb 2020 - 31 Mar 2023. Split over two files at 3 October 2021.
#     https://data.rivm.nl/covid-19/COVID-19_aantallen_gemeente_per_dag_tm_03102021.csv
#     https://data.rivm.nl/covid-19/COVID-19_aantallen_gemeente_per_dag.csv
#     Metadata: https://data.overheid.nl/dataset/12900-covid-19-aantallen-per-gemeente-per-publicatiedatum
#     Licence: Public Domain Mark 1.0
#   RIVM, SARS-CoV-2 in wastewater, national average per day, since
#     7 Sep 2020 (still updated, weekly since July 2025).
#     https://data.rivm.nl/covid-19/COVID-19_rioolwaterdata_landelijk.csv
#     Metadata: https://data.overheid.nl/dataset/83426-covid-19-nationale-sars-cov-2-afvalwatersurveillance-landelijke-dagcijfers
#     Licence: CC BY 4.0
#   Our World in Data, COVID-19 vaccinations for the Netherlands.
#     https://catalog.ourworldindata.org/garden/covid/latest/vaccinations_global/vaccinations_global.csv
#     Licence: CC BY 4.0
#     (OWID's GitHub repo github.com/owid/covid-19-data was archived in
#     August 2024 and points to this catalog file instead.)
#
# Writes: data/covid_nl.json (day). Columns:
#   cases        positive tests published that day (all municipalities)
#   deaths       deaths published that day; RIVM stopped on 1 Jan 2023
#   vaccinations doses given per day, 7-day average (OWID)
#   fully_vaccinated_pct  share of people with a full first course (OWID)
#   wastewater   virus particles per 100,000 people (RIVM national average)
# The series runs from the first case to the last wastewater measurement,
# so cases are null after March 2023, when the GGD test sites closed.
#
# Run from the project folder: Rscript r/fetch_covid_nl.R

source("r/common.R")

# --- RIVM cases and deaths ---------------------------------------------------
# Each file has one row per municipality per day, plus one row per GGD for
# reports where the municipality is not known. All rows are summed, so the
# unknown-municipality reports are counted too.

rivm_old_url <- "https://data.rivm.nl/covid-19/COVID-19_aantallen_gemeente_per_dag_tm_03102021.csv"
rivm_new_url <- "https://data.rivm.nl/covid-19/COVID-19_aantallen_gemeente_per_dag.csv"

rivm_old <- read.csv(download_raw(rivm_old_url, "rivm_gemeente_per_dag_tm_03102021.csv"), sep = ";")
rivm_new <- read.csv(download_raw(rivm_new_url, "rivm_gemeente_per_dag.csv"), sep = ";")
rivm <- rbind(rivm_old, rivm_new)

# From 1 January 2023 RIVM no longer counts deaths and writes 9999 instead.
rivm$Deceased[rivm$Deceased == 9999] <- NA

cases_per_day <- aggregate(Total_reported ~ Date_of_publication, data = rivm, FUN = sum)
# na.action = na.pass keeps the days with NA, and sum() then gives NA for them.
deaths_per_day <- aggregate(Deceased ~ Date_of_publication, data = rivm, FUN = sum,
                            na.action = na.pass)

# --- RIVM wastewater ---------------------------------------------------------

wastewater_url <- "https://data.rivm.nl/covid-19/COVID-19_rioolwaterdata_landelijk.csv"
wastewater <- read.csv(download_raw(wastewater_url, "rivm_rioolwater_landelijk.csv"), sep = ";")

# --- OWID vaccinations -------------------------------------------------------

vaccinations_url <- "https://catalog.ourworldindata.org/garden/covid/latest/vaccinations_global/vaccinations_global.csv"
vaccinations <- read.csv(download_raw(vaccinations_url, "owid_vaccinations_global.csv"))
vaccinations <- vaccinations[vaccinations$country == "Netherlands", ]

# --- Join everything on the date ---------------------------------------------
# match() looks up each day in a source and gives NA when the source has no
# row for that day.

first_day <- as.Date(min(cases_per_day$Date_of_publication))
last_day <- as.Date(max(wastewater$Date_measurement))
days <- seq(first_day, last_day, by = "day")
key <- format(days)

series <- data.frame(
  date = days,
  cases = cases_per_day$Total_reported[match(key, cases_per_day$Date_of_publication)],
  deaths = deaths_per_day$Deceased[match(key, deaths_per_day$Date_of_publication)],
  vaccinations = round(vaccinations$daily_vaccinations_smoothed[match(key, vaccinations$date)]),
  fully_vaccinated_pct = round(vaccinations$people_fully_vaccinated_per_hundred[match(key, vaccinations$date)], 2),
  wastewater = wastewater$RNA_flow_per_100000[match(key, wastewater$Date_measurement)]
)

write_outbreak(
  id = "covid_nl",
  name = "COVID-19, Netherlands",
  source = "RIVM (cases, deaths); RIVM (wastewater); Our World in Data (vaccinations)",
  url = paste(rivm_new_url, wastewater_url, vaccinations_url, sep = "; "),
  licence = "Public Domain Mark 1.0; CC BY 4.0; CC BY 4.0",
  interval = "day",
  notes = paste(
    "Cases and deaths by date of publication by RIVM, not date of illness, so weekends and holidays show dips.",
    "Deaths stop on 2022-12-31 and cases on 2023-03-31.",
    "vaccinations is doses per day (7-day average); fully_vaccinated_pct is per 100 people, only on days it was reported;",
    "wastewater is SARS-CoV-2 particles per 100,000 people (national average, weekly since July 2025)."
  ),
  series = series
)
