# fetch_measles_mpox.R: measles (two datasets) and mpox.
#
# Sources:
#   outbreaks::measles_hagelloch_1861: line list of 188 cases in the village
#     of Hagelloch, Germany, 1861 (one row per child: onset date, death...)
#   Our World in Data, measles cases (yearly, WHO)
#     https://ourworldindata.org/measles  - check the CSV link and licence (CC BY)
#   Our World in Data, mpox (daily, since 2022)
#     https://github.com/owid/monkeypox - check the CSV link and licence (CC BY)
#
# Writes: data/measles1861.json (day), data/measles_world.json (year),
#         data/mpox.json (day)
#
# Raw downloads go in data/raw/ (not committed).

source("r/common.R")

# TODO: measles1861: count cases per onset date (date_of_prodrome or
#   date_of_rash), deaths per date_of_death.
# TODO: measles_world and mpox: download to data/raw/, pick the columns,
#   write_outbreak().
