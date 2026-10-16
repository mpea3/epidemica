# fetch_ebola.R: Ebola, West Africa 2014-16.
#
# Sources:
#   outbreaks::ebola_sierraleone_2014: line list of confirmed cases in
#     Sierra Leone, 2014 (onset date, outcome, district)
#   WHO situation reports, country totals for Guinea, Liberia, Sierra Leone
#     (via the Humanitarian Data Exchange) - check the link and licence
#
# Writes: data/ebola_sl2014.json (day), data/ebola_westafrica.json (week)

source("r/common.R")

# TODO: ebola_sl2014: cases per date_of_onset.
# TODO: ebola_westafrica: download to data/raw/, weekly new cases and deaths
#   per country (the reports give cumulative totals: take differences).
