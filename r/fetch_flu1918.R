# fetch_flu1918.R: 1918 influenza in Baltimore, Maryland.
#
# Source:  EpiEstim::Flu1918 (Frost & Sydenstricker, 1919), shipped with the
#          EpiEstim package; no download needed.
# Has:     $incidence, 92 days of new cases; $si_distr, the serial interval.
# Writes:  data/flu1918.json (interval "day"; cases, no deaths)
#
# Run from the project folder: Rscript r/fetch_flu1918.R

source("r/common.R")

# TODO: load EpiEstim::Flu1918, give each day a date (the data starts on
# 1918-09-?? - check the package docs), then call write_outbreak().
