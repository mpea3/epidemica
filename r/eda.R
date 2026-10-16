# eda.R: exploratory analysis of the cleaned datasets, for the report.
# Saves base-R plots to docs/figures/ and prints a summary table.
#
# Run from the project folder, after the fetch_*.R scripts:
#   Rscript r/eda.R
#
# Figures:
#   overview.png                  new cases over time, one panel per dataset
#   growth_windows.png            early growth on a log scale, with the
#                                 window and fitted line used for R0
#   flu1918_rt.png                1918 flu: cases and R(t) from fit.R
#   measles1861_serial_interval.png  serial intervals measured from the
#                                 Hagelloch line list
#   ebola_westafrica_countries.png   weekly cases in the three countries
#   covid_nl_wastewater.png       COVID-19 cases and wastewater, Netherlands

suppressPackageStartupMessages(library(jsonlite))

figures <- file.path("docs", "figures")
dir.create(figures, recursive = TRUE, showWarnings = FALSE)

reported_colour <- "grey45"
fitted_colour <- "#1f6fb2"

read_outbreak <- function(id) {
  outbreak <- fromJSON(file.path("data", paste0(id, ".json")))
  outbreak$series$date <- as.Date(outbreak$series$date)
  outbreak
}

# Runs fit.R the same way the app does and reads its JSON.
run_fit <- function(id) {
  out <- system2("Rscript", c("r/fit.R", "--outbreak", id), stdout = TRUE, stderr = FALSE)
  fromJSON(paste(out, collapse = ""))
}

# 7-day moving average, centred. Used only to make spiky daily data readable.
moving_average <- function(x, days = 7) {
  as.numeric(stats::filter(x, rep(1 / days, days), sides = 2))
}

save_png <- function(name, width = 1600, height = 1000) {
  png(file.path(figures, name), width = width, height = height, res = 150)
}

ids <- c("flu1918", "measles1861", "ebola_sl2014", "ebola_westafrica",
         "mpox", "covid_nl", "measles_world")
outbreaks <- lapply(ids, read_outbreak)
names(outbreaks) <- ids

# --- 1. Summary table --------------------------------------------------------

summary_rows <- lapply(outbreaks, function(o) {
  s <- o$series[!is.na(o$series$cases), ]
  data.frame(
    id = o$id,
    interval = o$interval,
    from = min(s$date),
    to = max(s$date),
    cases = sum(s$cases),
    deaths = if (all(is.na(s$deaths))) NA else sum(s$deaths, na.rm = TRUE),
    peak = s$date[which.max(s$cases)]
  )
})
summary_table <- do.call(rbind, summary_rows)
rownames(summary_table) <- NULL
print(summary_table)

# --- 2. Overview: one panel per dataset ---------------------------------------

save_png("overview.png", height = 1400)
par(mfrow = c(4, 2), mar = c(3, 4, 2.5, 1))
for (o in outbreaks) {
  s <- o$series
  plot(s$date, s$cases, type = "h", col = reported_colour,
       main = o$name, xlab = "", ylab = paste("new cases per", o$interval))
  # A 7-day average over the spiky daily series that have many points.
  if (o$interval == "day" && nrow(s) > 200) {
    lines(s$date, moving_average(s$cases), col = fitted_colour, lwd = 1.5)
  }
}
invisible(dev.off())

# --- 3. Growth windows used for R0 --------------------------------------------
# Exponential growth is a straight line on a log scale. Each panel shows the
# daily cases, the window fit.R uses (shaded) and the fitted line.

fits <- lapply(ids[ids != "measles_world"], run_fit)
names(fits) <- ids[ids != "measles_world"]

save_png("growth_windows.png", height = 1300)
par(mfrow = c(3, 2), mar = c(3, 4, 2.5, 1))
for (id in names(fits)) {
  o <- outbreaks[[id]]
  fit <- fits[[id]]
  window <- as.Date(fit$r0_window)
  s <- o$series[!is.na(o$series$cases), ]
  # Show the window plus some time either side of it.
  span <- as.numeric(window[2] - window[1])
  s <- s[s$date >= window[1] - span / 2 & s$date <= window[2] + span, ]
  positive <- s$cases > 0

  plot(s$date[positive], s$cases[positive], log = "y", pch = 16, cex = 0.5,
       col = reported_colour, xlab = "", ylab = "new cases (log scale)",
       main = sprintf("%s: R0 %.2f (%.2f-%.2f)", id, fit$r0, fit$r0_ci[1], fit$r0_ci[2]))
  usr <- par("usr")
  rect(window[1], 10^usr[3], window[2], 10^usr[4],
       col = adjustcolor(fitted_colour, 0.12), border = NA)

  # Refit the same regression as fit.R to draw its line.
  early <- s[s$date >= window[1] & s$date <= window[2], ]
  early$t <- as.numeric(early$date - window[1])
  glm_fit <- glm(round(cases) ~ t, family = quasipoisson, data = early)
  lines(early$date, fitted(glm_fit), col = fitted_colour, lwd = 2)
}
invisible(dev.off())

# --- 4. 1918 flu: cases and R(t) ----------------------------------------------

flu <- outbreaks$flu1918$series
flu_rt <- fits$flu1918$rt
flu_rt$date <- as.Date(flu_rt$date)

save_png("flu1918_rt.png")
par(mfrow = c(2, 1), mar = c(3, 4, 2.5, 1))
plot(flu$date, flu$cases, type = "h", lwd = 3, col = reported_colour,
     main = "Influenza, Baltimore 1918: new cases by day of onset",
     xlab = "", ylab = "new cases")
plot(flu_rt$date, flu_rt$mean, type = "n", ylim = c(0, max(flu_rt$hi)),
     xlim = range(flu$date), main = "R(t), 7-day windows (EpiEstim)",
     xlab = "", ylab = "R(t)")
polygon(c(flu_rt$date, rev(flu_rt$date)), c(flu_rt$lo, rev(flu_rt$hi)),
        col = adjustcolor(fitted_colour, 0.25), border = NA)
lines(flu_rt$date, flu_rt$mean, col = fitted_colour, lwd = 2)
abline(h = 1, lty = 2)
invisible(dev.off())

# --- 5. Measles 1861: serial interval from the line list ----------------------
# The line list says who infected whom. The serial interval of a pair is the
# days between the infector's first symptoms (prodrome) and the child's.
# fit.R uses the mean and SD printed here.

hagelloch <- outbreaks::measles_hagelloch_1861
infector_row <- match(hagelloch$infector, hagelloch$case_ID)
serial_interval <- as.numeric(hagelloch$date_of_prodrome -
                                hagelloch$date_of_prodrome[infector_row])
serial_interval <- serial_interval[!is.na(serial_interval)]
si_mean <- mean(serial_interval)
si_sd <- sd(serial_interval)
message(sprintf("Hagelloch serial interval: %d pairs, mean %.1f, SD %.1f days",
                length(serial_interval), si_mean, si_sd))

save_png("measles1861_serial_interval.png", height = 900)
hist(serial_interval, breaks = seq(0.5, max(serial_interval) + 0.5, by = 1),
     freq = FALSE, col = "grey85", border = "white",
     main = sprintf("Measles, Hagelloch 1861: serial interval (%d pairs)",
                    length(serial_interval)),
     xlab = "days from infector's prodrome to case's prodrome", ylab = "share of pairs")
# Gamma distribution with the same mean and SD: shape = (mean/sd)^2,
# rate = mean / sd^2.
curve(dgamma(x, shape = (si_mean / si_sd)^2, rate = si_mean / si_sd^2),
      add = TRUE, col = fitted_colour, lwd = 2)
legend("topright", bty = "n", lwd = 2, col = fitted_colour,
       legend = sprintf("gamma, mean %.1f, SD %.1f", si_mean, si_sd))
invisible(dev.off())

# --- 6. Ebola: three countries ------------------------------------------------

ebola <- outbreaks$ebola_westafrica$series
country_columns <- c("cases_guinea", "cases_liberia", "cases_sierra_leone")
country_colours <- c("#d1495b", "#edae49", "#00798c")

save_png("ebola_westafrica_countries.png", height = 900)
matplot(ebola$date, ebola[, country_columns], type = "l", lty = 1, lwd = 2,
        col = country_colours, main = "Ebola, West Africa: new cases per week (WHO)",
        xlab = "", ylab = "new cases per week", xaxt = "n")
axis.Date(1, ebola$date)
legend("topright", bty = "n", lwd = 2, col = country_colours,
       legend = c("Guinea", "Liberia", "Sierra Leone"))
invisible(dev.off())

# --- 7. COVID-19 Netherlands: cases and wastewater ---------------------------
# Both on a log scale, so the shapes can be compared even though the units
# differ. Cases stop when testing stopped (March 2023); wastewater goes on.

covid <- outbreaks$covid_nl$series
wastewater_colour <- "#b5651d"  # reported data too, so not the fitted blue

save_png("covid_nl_wastewater.png", height = 900)
par(mar = c(3, 4, 2.5, 4))
plot(covid$date, moving_average(covid$cases), type = "l", log = "y",
     col = reported_colour, lwd = 2, xlab = "", ylab = "new cases (7-day average)",
     main = "COVID-19, Netherlands: cases and virus in wastewater")
par(new = TRUE)
plot(covid$date, covid$wastewater, type = "l", log = "y", col = wastewater_colour,
     axes = FALSE, xlab = "", ylab = "")
axis(4, col.axis = wastewater_colour)
mtext("virus particles per 100,000 people", side = 4, line = 2.5, col = wastewater_colour)
legend("topleft", bty = "n", lwd = 2, col = c(reported_colour, wastewater_colour),
       legend = c("cases (RIVM)", "wastewater (RIVM)"))
invisible(dev.off())

message("figures written to ", figures)
