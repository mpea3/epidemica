# fetch_flu1918.R: 1918 influenza in Baltimore, Maryland.
#
# Source:   EpiEstim::Flu1918 (EpiEstim 2.2-5), from Frost W. and
#           E. Sydenstricker (1919) Influenza in Maryland: preliminary
#           statistics of certain localities. Public Health Rep. 34: 491-504.
# URL:      https://cran.r-project.org/package=EpiEstim
# Accessed: 2026-10-16
# Licence:  EpiEstim is GPL (>= 2); the 1919 report is public domain.
# Has:      $incidence, 92 days of new cases (by day of onset);
#           $si_distr, a discretised serial interval (mean 2.6 days).
# Writes:   data/flu1918.json (interval "day"; cases, no deaths)
#
# Start date. The package docs do not give a calendar date for day 1. We use
# 1 September 1918, for two reasons:
#   - The data come from a house-to-house survey (20 Nov - 15 Dec 1918) that
#     asked people when they fell ill. People remember round dates, and the
#     two biggest spikes in the series are on day 31 (405 cases) and day 45
#     (553 cases). With day 1 = 1 September those are 1 October and
#     15 October.
#   - Fraser et al. (2011, Am J Epidemiol 174: 505-514), who re-analysed the
#     same survey, count immunity "prior to September 1" and fit growth from
#     September 1.
# 92 days from 1 September runs to 1 December 1918.
#
# Run from the project folder: Rscript r/fetch_flu1918.R

source("r/common.R")
suppressPackageStartupMessages(library(EpiEstim))

data("Flu1918", package = "EpiEstim")

first_day <- as.Date("1918-09-01")
days <- seq(first_day, by = "day", length.out = length(Flu1918$incidence))

series <- data.frame(
  date = days,
  cases = Flu1918$incidence,
  deaths = NA
)

write_outbreak(
  id = "flu1918",
  name = "Influenza, Baltimore 1918",
  source = "EpiEstim::Flu1918 (Frost and Sydenstricker 1919, Public Health Reports 34)",
  url = "https://cran.r-project.org/package=EpiEstim",
  licence = "GPL (>= 2) (EpiEstim package); original report public domain",
  interval = "day",
  notes = paste(
    "Cases by day of onset from a household survey.",
    "Day 1 is assumed to be 1918-09-01 (not stated in the package); see r/fetch_flu1918.R."
  ),
  series = series
)
