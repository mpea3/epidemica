# parameters.R: serial interval, incubation and infectious period per
# disease, for fit.R and import.R. source() it; it does not print anything.
#
# Serial intervals and incubation periods come from epiparameter
# (https://epiverse-trace.github.io/epiparameter/), a curated library of
# published estimates. A disease is named as epiparameter names it
# ("COVID-19", "Ebola Virus Disease", "Influenza"), optionally with a
# pathogen ("Influenza-A-H1N1") when one disease covers very different
# viruses: without it, Influenza's incubation period would be the one for
# avian H7N9.
#
# For each parameter we ask epiparameter for one entry (single_epiparameter
# = TRUE, its pick of the best estimate), first for the pathogen and then for
# the disease as a whole. The serial interval falls back to the generation
# time when there is no serial interval; the two are often used in place of
# each other. Where epiparameter has neither, FALLBACK below fills the gap.
#
# epiparameter has no infectious periods at all, so those are always in
# FALLBACK. They only set the starting value of a simulator dial.

suppressPackageStartupMessages(library(epiparameter))

# Values epiparameter does not have, per disease, each with its source.
FALLBACK <- list(
  "Influenza" = list(
    # Virus shedding lasts 4-5 days: Carrat et al. 2008, Am J Epidemiol 167:
    #   775-785.
    infectious = list(mean = 4, source = "Carrat et al. 2008")
  ),
  "Measles" = list(
    # No serial interval for measles in epiparameter. 10.4 (SD 1.7) days is
    #   measured from the 184 child/infector pairs in the Hagelloch 1861 line
    #   list (prodrome to prodrome; see r/eda.R). Vink et al. 2014 (Am J
    #   Epidemiol 180: 865-875) give 11.7 days for measles in general.
    serial_interval = list(mean = 10.4, sd = 1.7,
                           source = "Hagelloch 1861 line list, r/eda.R"),
    # From the prodrome to about 4 days after the rash appears (the rash
    #   comes about 4 days after the prodrome).
    infectious = list(mean = 8, source = "prodrome to rash + 4 days")
  ),
  "Ebola Virus Disease" = list(
    infectious = list(mean = 5.6, source = "Chowell et al. 2004")
  ),
  "Mpox" = list(
    # Until the skin lesions have healed, 2-4 weeks (WHO mpox fact sheet).
    infectious = list(mean = 21, source = "WHO mpox fact sheet")
  ),
  "COVID-19" = list(
    # Infectiousness peaks around symptom onset and falls over the following
    #   week: He et al. 2020, Nat Med 26: 672-675. Rounded.
    infectious = list(mean = 7, source = "He et al. 2020")
  )
)

# One epiparameter entry, or NULL if there is none. epiparameter_db() stops
# with an error when nothing matches and prints a message when something
# does; we want neither.
find_entry <- function(disease, pathogen, epi_name) {
  tryCatch(
    suppressMessages(epiparameter_db(
      disease = disease, pathogen = pathogen, epi_name = epi_name,
      single_epiparameter = TRUE
    )),
    error = function(e) NULL
  )
}

# "Lessler et al. 2009, doi:10.1056/NEJMoa0906089"
short_citation <- function(entry) {
  cite <- entry$citation
  authors <- cite$author
  first <- if (length(authors) > 0) authors[[1]]$family else "unknown"
  if (length(first) == 0 || is.null(first)) first <- format(authors[[1]])
  who <- if (length(authors) > 1) paste(first, "et al.") else first
  doi <- if (!is.null(cite$doi)) paste0(", doi:", cite$doi) else ""
  paste0(who, " ", cite$year, doi)
}

# Mean and SD in days. A parameterised entry has a fitted distribution
# (gamma, lognormal, Weibull...), and its moments are exact. Some entries
# only report a mean and SD; those are read from summary_stats. The SD can
# be missing, in which case the entry is no use for R(t).
entry_moments <- function(entry) {
  if (is_parameterised(entry)) {
    dist <- entry$prob_distribution
    return(list(mean = mean(dist), sd = sqrt(distributional::variance(dist))))
  }
  ss <- entry$summary_stats
  list(mean = ss$mean %||% NA_real_, sd = ss$sd %||% NA_real_)
}

# The first of epi_names that epiparameter has for the pathogen, then for the
# disease ("all" pathogens), as list(mean, sd, source, kind). NULL if none.
lookup <- function(disease, pathogen, epi_names) {
  pathogens <- unique(c(pathogen, "all"))
  for (epi_name in epi_names) {
    for (p in pathogens) {
      entry <- find_entry(disease, p, epi_name)
      if (is.null(entry)) next
      m <- entry_moments(entry)
      if (is.na(m$mean)) next
      return(list(
        mean = round(m$mean, 2), sd = round(m$sd, 2),
        source = paste0(short_citation(entry), " (epiparameter, ",
                        entry$pathogen, ")"),
        kind = epi_name
      ))
    }
  }
  NULL
}

# Everything fit.R needs for one disease:
#   list(disease, pathogen,
#        serial_interval = list(mean, sd, source, kind),
#        incubation      = list(mean, sd, source, kind) or NULL,
#        infectious      = list(mean, source) or NULL)
# Stops if there is no serial interval, since R(t) and R0 need one.
disease_parameters <- function(disease, pathogen = NULL) {
  if (is.null(disease) || !nzchar(disease)) stop("no disease given")
  fallback <- FALLBACK[[disease]] %||% list()

  si <- lookup(disease, pathogen, c("serial interval", "generation time"))
  if (is.null(si) || is.na(si$sd)) si <- fallback$serial_interval
  if (is.null(si)) {
    stop("epiparameter has no serial interval or generation time for ",
         disease, ", and r/parameters.R has no fallback for it")
  }

  list(
    disease = disease,
    pathogen = pathogen,
    serial_interval = si,
    incubation = lookup(disease, pathogen, "incubation period"),
    infectious = fallback$infectious
  )
}

# Diseases the import can be tagged with: everything epiparameter has a
# serial interval, generation time or incubation period for, plus the
# FALLBACK diseases. canFit says whether fit.R will find a serial interval.
known_diseases <- function() {
  tbl <- as.data.frame(parameter_tbl(suppressMessages(epiparameter_db())))
  wanted <- c("serial interval", "generation time", "incubation period")
  tbl <- tbl[tbl$epi_name %in% wanted, ]
  names <- sort(unique(c(tbl$disease, names(FALLBACK))))
  lapply(names, function(d) {
    rows <- tbl[tbl$disease == d, ]
    has_si <- any(rows$epi_name %in% wanted[1:2]) ||
      !is.null(FALLBACK[[d]]$serial_interval)
    list(
      disease = d,
      pathogens = I(sort(unique(rows$pathogen))),
      canFit = has_si
    )
  })
}
