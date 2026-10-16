# install.R: installs the R packages Epidemica uses into your user library
# (R_LIBS_USER, ~/R on Mae's laptop). Run once: Rscript r/install.R
#
# frictionless needs the curl package, which builds against libcurl's
# headers. On Debian/Ubuntu: sudo apt install libcurl4-openssl-dev

packages <- c(
  "jsonlite",  # JSON for the app
  "EpiEstim",  # R(t); also the Flu1918 and Measles1861 datasets
  "outbreaks", # historic outbreak datasets
  "deSolve",   # SIR reference model
  "mgcv",        # smoothing noisy case series
  "epiparameter", # serial intervals and incubation periods per disease
  "frictionless", # checking imported CSVs against r/import-schema.json
  "readr"         # reading imported CSVs
)

lib <- Sys.getenv("R_LIBS_USER")
dir.create(lib, recursive = TRUE, showWarnings = FALSE)

missing <- setdiff(packages, rownames(installed.packages()))
if (length(missing) > 0) {
  install.packages(missing, lib = lib, repos = "https://cloud.r-project.org")
} else {
  message("all packages installed")
}
