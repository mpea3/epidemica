# fetch_ebola.R: Ebola, West Africa 2014-16.
#
# Sources (all accessed 2026-10-16):
#   outbreaks::ebola_sierraleone_2014 (outbreaks 1.9.0): line list of 11,903
#     confirmed and suspected cases in Sierra Leone, May 2014 - Sep 2015
#     (Fang et al. 2016, PNAS 113: 4488-4493).
#     https://cran.r-project.org/package=outbreaks   Licence: GPL (>= 2)
#   WHO Ebola situation reports, cumulative cases and deaths per country,
#     as collected by the Humanitarian Data Exchange (dataset
#     "ebola-cases-2014", reports from 2014-08-29 to 2016-03-23).
#     https://data.humdata.org/dataset/ebola-cases-2014
#     File: https://data.humdata.org/dataset/0d089fa0-3567-4b01-9c03-39d340ff34e3/resource/c59b5722-ca4b-41ca-a446-472d6d824d01/download/ebola_data_db_format.csv
#     Licence: WHO copyright, free for research and non-commercial use
#     (https://www.who.int/about/policies/publishing/copyright)
#
# Writes: data/ebola_sl2014.json (day), data/ebola_westafrica.json (week)
#
# Run from the project folder: Rscript r/fetch_ebola.R

source("r/common.R")
suppressPackageStartupMessages(library(outbreaks))

# --- Sierra Leone line list, cases per day of onset --------------------------
# Confirmed and suspected cases are both counted; confirmed is kept as an
# extra column. The line list has no outcome, so there are no deaths.

sl <- outbreaks::ebola_sierraleone_2014

all_cases <- count_per_day(sl$date_of_onset)
confirmed <- count_per_day(sl$date_of_onset[sl$status == "confirmed"],
                           min(all_cases$date), max(all_cases$date))

write_outbreak(
  id = "ebola_sl2014",
  name = "Ebola, Sierra Leone 2014-15",
  source = "outbreaks::ebola_sierraleone_2014 (Fang et al. 2016, PNAS 113)",
  url = "https://cran.r-project.org/package=outbreaks",
  licence = "GPL (>= 2) (outbreaks package)",
  interval = "day",
  notes = "Confirmed and suspected cases by day of symptom onset; confirmed is the confirmed part only. No deaths in this line list.",
  series = data.frame(
    date = all_cases$date,
    cases = all_cases$n,
    deaths = NA,
    confirmed = confirmed$n
  )
)

# --- WHO country totals, new cases and deaths per week -----------------------
# The situation reports give running totals (confirmed + probable +
# suspected) on irregular dates, sometimes two days apart, sometimes two
# weeks. To get a regular weekly series we:
#   1. read the running total for each country on each report date,
#   2. estimate the running total on every Sunday by drawing a straight line
#      between the reports before and after it (linear interpolation),
#   3. take the difference between one Sunday and the next: new per week.
# Totals sometimes go down when suspected cases are ruled out. Those weeks
# give a negative difference, which is not a real count, so they become NA.
#
# Only the three countries with widespread transmission are kept. The
# "Guinea 2" and "Liberia 2" rows in the file are small flare-ups after the
# main epidemic was declared over (under 50 cases) and are left out.

ebola_url <- "https://data.humdata.org/dataset/0d089fa0-3567-4b01-9c03-39d340ff34e3/resource/c59b5722-ca4b-41ca-a446-472d6d824d01/download/ebola_data_db_format.csv"
who <- read.csv(download_raw(ebola_url, "ebola_who_hdx.csv"))
who$Date <- as.Date(who$Date)

countries <- c("Guinea", "Liberia", "Sierra Leone")
case_indicator <- "Cumulative number of confirmed, probable and suspected Ebola cases"
death_indicator <- "Cumulative number of confirmed, probable and suspected Ebola deaths"

# Sundays from the first report to the last.
first_sunday <- min(who$Date) + (7 - as.integer(format(min(who$Date), "%u"))) %% 7
sundays <- seq(first_sunday, max(who$Date), by = "week")

# Weekly new counts for one country and one indicator, on the Sundays.
weekly_new <- function(country, indicator) {
  rows <- who[who$Country == country & who$Indicator == indicator, ]
  rows <- rows[order(rows$Date), ]
  running_total <- approx(rows$Date, rows$value, xout = sundays)$y
  new <- c(NA, diff(running_total))
  new[!is.na(new) & new < 0] <- NA
  round(new)
}

westafrica <- data.frame(date = sundays)
for (country in countries) {
  column <- tolower(gsub(" ", "_", country))
  westafrica[[paste0("cases_", column)]] <- weekly_new(country, case_indicator)
  westafrica[[paste0("deaths_", column)]] <- weekly_new(country, death_indicator)
}

# Totals over the three countries. A week with NA in any country is NA.
westafrica$cases <- westafrica$cases_guinea + westafrica$cases_liberia +
  westafrica$cases_sierra_leone
westafrica$deaths <- westafrica$deaths_guinea + westafrica$deaths_liberia +
  westafrica$deaths_sierra_leone

# The first Sunday has no week before it to compare with.
westafrica <- westafrica[-1, ]

# Cases counted in the first report happened before the series starts.
first_report <- who[who$Date == min(who$Date) & who$Country %in% countries &
                      who$Indicator == case_indicator, ]
cases_before <- sum(first_report$value)

# Put the three columns the app needs first.
first_columns <- c("date", "cases", "deaths")
westafrica <- westafrica[, c(first_columns, setdiff(names(westafrica), first_columns))]

write_outbreak(
  id = "ebola_westafrica",
  name = "Ebola, West Africa 2014-16",
  source = "WHO Ebola situation reports, via the Humanitarian Data Exchange",
  url = ebola_url,
  licence = "WHO copyright: free for research and non-commercial use",
  interval = "week",
  notes = paste(
    "New cases and deaths (confirmed, probable and suspected) in the week ending on each Sunday,",
    "from the differences between interpolated running totals.",
    "Weeks where a total went down (reclassification) are null.",
    "The first report already counts", cases_before, "cases; those are not in the series."
  ),
  series = westafrica
)
