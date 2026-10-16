# fetch_covid_nl.R: COVID-19 in the Netherlands.
#
# Sources:
#   RIVM, cases and deaths per municipality per day (stopped in 2023)
#     https://data.rivm.nl - search "COVID-19_aantallen_gemeente_per_dag"
#   RIVM, SARS-CoV-2 in wastewater, national (still updated weekly)
#     https://data.overheid.nl/en/dataset/38662-covid-19-nationale-sars-cov-2-afvalwatersurveillance-landelijke-dagcijfers
#   Our World in Data, vaccinations for the Netherlands
#     https://github.com/owid/covid-19-data - check the CSV link (CC BY)
# RIVM open data is CC0. Check each link and record the access date.
#
# Writes: data/covid_nl.json (day; cases, deaths, plus vaccinations and
#         wastewater as extra columns)

source("r/common.R")

# TODO: download to data/raw/, sum municipalities per day, join the
#   vaccination and wastewater series by date, write_outbreak().
