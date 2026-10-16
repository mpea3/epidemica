# Epidemica

A desktop app for looking at past epidemics and simulating new ones.

Epidemica has two modes:

- **History.** Charts of real outbreaks: daily cases, deaths and the reproduction number R(t) over time. Pick two outbreaks and compare them on the same axes.
- **Simulate.** An agent-based dashboard. Describe a virus (how easily it spreads, how long people are ill, how many show symptoms, how deadly it is), pick a setting (a city, a school, a care home) and watch it move through a population. Change the dials while it runs.

The two modes are linked. R fits parameters to a past outbreak, and those parameters can be loaded straight into the simulator: "what if measles in 1861 had hit a modern city?"

A simulation is not a prediction. Every line in the app is labelled **Reported** (real data), **Fitted** (estimated by R from real data) or **Simulated** (made up by the model), and each label has its own fixed colour.

Semester 3 (Data Dynamics) individual project, T!CS, NHL Stenden, 2026-2027.

## Problem and objectives

Numbers like "R0 = 2.5" or "5 day incubation" are reported for every new outbreak, but it is hard to picture what they mean. Why did measles spread so much faster than Ebola? Why can a virus with mild symptoms be harder to stop than a deadly one? How much does a lockdown on day 20 change compared with one on day 40?

Epidemica tries to answer those questions by putting real outbreak data next to a simulation you can play with.

Objectives:

1. Clean and chart at least four historic outbreaks from public data, with R as the analysis language.
2. Estimate R0 and R(t) for each outbreak in R, with uncertainty intervals.
3. Build an agent-based simulator whose fully mixed runs match the textbook SIR final size within 5% (see [Checking the model](#checking-the-model)).
4. Let a user load fitted parameters from a past outbreak into the simulator and compare the simulated curve with the reported one.

## Simulation model

Each person is an agent that walks around a square world. An agent is in one of these states:

```
Susceptible -> Exposed -> Infectious -> Recovered
                              |             |
                              v             v (waning immunity)
                             Dead       Susceptible
```

- One tick is one simulated hour. Charts show daily totals (24 ticks).
- An infectious agent can infect any susceptible agent inside its contact radius. The chance per contact per tick is **p = R0 / (c x D)**, where c is the expected number of contacts per tick and D is the infectious period in ticks. With this choice, one infectious agent in a fully susceptible population causes R0 infections on average.
- Time spent in Exposed and Infectious is drawn around the dial value (uniformly between half and one and a half times it), so not everyone recovers on the same day.
- Because p is divided by c, R0 means the same in every setting. Density and movement change how fast the virus gets around, not R0.
- The world wraps at the edges, so there are no corners to hide in. A grid of cells one contact radius wide means an agent only checks its own cell and the 8 around it for contacts.
- Agents walk in a straight line and now and then turn. Symptomatic agents walk slower by the self-isolation dial.
- Lockdown: from the lockdown day agents walk at a quarter of their speed, and the contacts that still happen pass the virus on at 30% of the usual chance.
- Testing: a symptomatic case is tested with the chance on the testing dial, and isolated (no movement, no contacts) one day after its symptoms start. Cases without symptoms are never tested.
- Vaccinated agents start as Recovered, so with waning immunity they become susceptible again too.
- A run is seeded: the same seed and dials give exactly the same run.

### Dials

| Group | Dial | What it does |
|---|---|---|
| Spread | R0 | Average number of people one case infects in a fully susceptible population |
| | Incubation period (days) | Time in Exposed before becoming infectious |
| | Infectious period (days) | Time spent infectious |
| Symptoms | Share asymptomatic | Infected agents who never show symptoms |
| | Asymptomatic infectiousness | How infectious a case without symptoms is, relative to one with symptoms |
| | Self-isolation | How much symptomatic agents cut their movement |
| Outcome | Fatality | Share of cases that die |
| | Waning immunity (days) | How long recovery protects; off means lifelong |
| Interventions | Masks | Cut in the chance of passing it on per contact |
| | Vaccination coverage | Share of agents who start immune |
| | Lockdown day | Day movement drops; off means never |
| | Testing and isolation | Share of symptomatic cases found and removed from contact |

### Settings

A setting is a preset for population size, density, movement and age mix:

| Setting | Idea |
|---|---|
| City | Many people, dense, lots of movement |
| Village | Few people, spread out |
| School | Dense in the day, mostly young, low fatality |
| Care home | Small, dense, old, high fatality |
| Festival / cruise ship | Very dense, closed population |

### Load from history

Pick a past outbreak and R estimates its R0, incubation and infectious period. The app fills the dials with those values, and the reported curve is drawn behind the simulated one.

### Checking the model

The simulator has to agree with theory before its curves mean anything. In a fully mixed population, the share of people an SIR epidemic ends up infecting, z, solves

```
z = 1 - exp(-R0 * z)
```

The engine test runs 20 seeded, fully mixed outbreaks of 5,000 agents at R0 1.8, 2.5 and 4 and checks that the mean attack rate is within 5% of z. Fully mixed is a setting (`fullyMixed`) in which every infectious agent can meet every other agent, as the formula assumes. R's `deSolve` SIR model is used as a second reference.

| R0 | z (theory) | Mean attack rate, 20 runs |
|---|---|---|
| 1.8 | 0.7324 | 0.7323 |
| 2.5 | 0.8926 | 0.8937 |
| 4 | 0.9802 | 0.9802 |

Speed: `hutch test ./src/engine/bench.ts` reports the time per tick. On the development laptop a tick takes about 0.3 ms at 5,000 agents and 3 to 6 ms at 50,000, against 16 ms available per frame at 60 frames a second.

## Where R fits

R does the data science. It runs in two ways:

- **Offline pipeline.** `r/fetch_*.R` scripts download the raw data, clean it into one shape (date, new cases, deaths, plus R(t) and its interval) and write `data/<outbreak>.json`. The app only ever reads these files, so it works without the internet.
- **Live from the app.** When you press "Fit" or "Load from history", the app runs `Rscript r/fit.R --outbreak <id>` and reads JSON back from it: R0 with a 95% interval, R(t) per day, and incubation and infectious periods for the simulator dials.
- **Importing your own data.** The History tab's "import csv" button, or `Rscript r/import.R`, checks a CSV and writes it in the same `data/<id>.json` shape. See [Importing a dataset](#importing-a-dataset).
- **For the report.** `Rscript r/eda.R` prints a summary table and saves plots to `docs/figures/`: every dataset on one page, the early growth windows behind each R0, R(t) for 1918 flu, the Hagelloch serial interval, Ebola by country, and COVID-19 cases next to wastewater.

How `fit.R` estimates things:

- **R(t)** comes from EpiEstim (Cori et al. 2013) over sliding 7-day windows, with a gamma serial interval per disease (the mean and SD of the epiparameter estimate, whatever shape that estimate has). Windows with fewer than 12 cases are left out, because their intervals are too wide to mean much. Weekly counts are spread evenly over their 7 days first, since the CRAN version of EpiEstim only takes daily counts.
- **R0** comes from the growth rate r in an early window, picked per outbreak (a quasi-Poisson regression of cases on time), turned into R0 with Wallinga and Lipsitch (2007): R0 = (1 + r s^2 / m)^(m^2 / s^2) for a serial interval with mean m and SD s.
- **Serial intervals and incubation periods** come from [epiparameter](https://epiverse-trace.github.io/epiparameter/), a curated library of published estimates, so any disease it covers can be fitted. `r/parameters.R` asks it for one entry per disease (its own pick of the best one), first for the pathogen if the dataset names one (1918 flu asks for Influenza-A-H1N1, since the default Influenza incubation period is the one for avian H7N9), then for the disease as a whole. Where there is no serial interval it uses the generation time.
- **Gaps in epiparameter** are filled in `r/parameters.R` with their source: it has no infectious periods at all (those only set a dial's starting value) and no serial interval for measles (we use the one measured from the Hagelloch line list in `r/eda.R`).
- **Growth windows** for the built-in outbreaks are in a table at the top of `fit.R`, with the reasoning for each. An imported dataset can give its own; without one, `fit.R` takes the first wave (from the first case to the peak of the 7-day average). On the built-in outbreaks that lands within about 10% of the hand-picked R0, except COVID-19 in the Netherlands (1.37 against 2.54), where the lockdown came before the peak.

Switching to epiparameter on 2026-10-16 moved the built-in R0s a little: 1918 flu 1.36 to 1.35, Ebola Sierra Leone 1.40 to 1.36, Ebola West Africa 1.21 to 1.19, mpox 1.43 to 1.28 (epiparameter's mpox serial interval is Guo et al. 2022, 5.6 days, where we had Madewell et al. 2023, 8.5 days). Measles and COVID-19 are unchanged.

R packages:

| Package | Used for |
|---|---|
| jsonlite | Writing JSON for the app |
| EpiEstim | R(t) from daily incidence and a serial interval; also ships the 1918 flu and 1861 measles datasets |
| outbreaks | Historic outbreak datasets |
| deSolve | SIR reference model |
| mgcv | Smoothing noisy case series (GAM) |
| epiparameter | Serial intervals and incubation periods per disease |
| frictionless | Checking imported CSVs against a Frictionless Table Schema |
| readr | Reading imported CSVs |

## Datasets

| id | Outbreak | Source | Per |
|---|---|---|---|
| `covid_nl` | COVID-19, Netherlands 2020-23 | RIVM open data: [cases and deaths per municipality](https://data.rivm.nl/covid-19/), [wastewater, national](https://data.overheid.nl/dataset/83426-covid-19-nationale-sars-cov-2-afvalwatersurveillance-landelijke-dagcijfers); [Our World in Data](https://catalog.ourworldindata.org/garden/covid/latest/vaccinations_global/vaccinations_global.csv) for vaccinations | day |
| `flu1918` | Influenza, Baltimore 1918 | `EpiEstim::Flu1918` | day |
| `ebola_sl2014` | Ebola, Sierra Leone 2014-15 | `outbreaks::ebola_sierraleone_2014` (line list) | day |
| `ebola_westafrica` | Ebola, Guinea, Liberia and Sierra Leone 2014-16 | WHO situation reports via the [Humanitarian Data Exchange](https://data.humdata.org/dataset/ebola-cases-2014) | week |
| `measles1861` | Measles, Hagelloch 1861 | `outbreaks::measles_hagelloch_1861` (line list) | day |
| `measles_world` | Measles, worldwide 1980-2024 | WHO, via [Our World in Data](https://ourworldindata.org/grapher/reported-cases-of-measles) | year |
| `mpox` | Mpox, worldwide since 2022 | WHO, via [Our World in Data](https://catalog.ourworldindata.org/garden/who/latest/monkeypox/monkeypox.csv) | day |

Source URLs, access dates and licences are kept in the header of each `r/fetch_*.R` script, repeated in each `data/<id>.json` and repeated in the report. Things worth knowing:

- **Moved sources.** Our World in Data archived its GitHub repos for COVID-19 (August 2024) and mpox; both now point to the OWID data catalog, which is what the scripts read. The RIVM wastewater dataset has a new page on data.overheid.nl (83426); the CSV address on data.rivm.nl is unchanged.
- **1918 start date.** `Flu1918` has no calendar dates. We take day 1 as 1 September 1918: the biggest spikes then fall on 1 and 15 October, round dates people gave when the survey asked when they fell ill, and Fraser et al. (2011) use the same start. Reasoning in `r/fetch_flu1918.R`.
- **COVID-19 dates** are RIVM publication dates, not dates of illness. RIVM stopped counting deaths on 1 January 2023 and cases on 31 March 2023, when the GGD test sites closed; wastewater runs on to today.
- **Ebola, West Africa.** The WHO reports give running totals on irregular dates. The script interpolates them to every Sunday and takes differences. Weeks where a total went down (cases reclassified) are null.

## Importing a dataset

Bring your own outbreak as a CSV with one row per date (or one row per case). In the app, press **import csv** in the History tab, pick the file, and tag its columns: which one is the date, which the new cases and which the new deaths. Then name the disease. The same thing from a terminal:

```bash
Rscript r/import.R --inspect my_cases.csv     # columns, first rows, a guess at the tags
Rscript r/import.R --diseases                 # the disease names epiparameter knows
Rscript r/import.R --csv my_cases.csv --id flu_town_2025 --name "Flu, my town 2025" \
    --date Datum --cases Besmettingen --deaths Overleden --date-format %d-%m-%Y \
    --disease Influenza --pathogen Influenza-A-H1N1
```

- **Tags.** `--date`, `--cases` and `--deaths` name columns in your CSV, the way the linelist package tags columns; the other columns are left out. Without `--cases` the file is read as a line list, one row per case, and the rows are counted per day.
- **Checks.** `r/import-schema.json` is a [Frictionless Table Schema](https://specs.frictionlessdata.io/table-schema/) for the tagged columns: a date that is there and appears once, and whole numbers of at least 0. `import.R` names its fields after your columns and reads the file with the frictionless package. frictionless reports values of the wrong type but does not check constraints, so `import.R` checks those from the same schema. If anything fails nothing is written, and you get every problem with its line number in the CSV.
- **Shape.** The dates are put in order and every missing day (or week, or year) gets a row with no count, which is not the same as 0. Weekly and yearly data are recognised from the gaps between dates. `,`, `;` and tab are all accepted as the separator.
- **Disease.** Stored in the JSON as `disease` (and `pathogen`), with the optional `growth_window`, for `fit.R`. Diseases that epiparameter has no serial interval for can be imported and charted, but not fitted.
- **Where it goes.** The app keeps imports in its own folder (`~/.local/share/dev.mae.epidemica/<channel>/data/` on Linux), so a rebuild does not remove them, and marks them "(imported)" in the list. From a terminal they go to `data/` unless you pass `--out`. An id the app already has is refused.

## Architecture

```mermaid
flowchart LR
    subgraph Offline
        SRC[Public data<br/>RIVM, WHO, OWID,<br/>R packages] --> FETCH[r/fetch_*.R]
        FETCH --> DATA[data/*.json]
    end
    subgraph App
        MAIN[Main process<br/>window, files,<br/>Rscript bridge]
        subgraph Webview
            UI[UI: charts, canvas, dials]
            W[Web Worker<br/>simulation engine]
        end
        UI <-->|RPC| MAIN
        UI <-->|postMessage| W
    end
    DATA --> MAIN
    MAIN -->|spawn| FIT[r/fit.R]
    FIT -->|JSON| MAIN
```

- The engine runs in a Web Worker inside the webview, so the agent positions it produces every tick never have to cross the RPC bridge. WebKitGTK will not start a Worker from a `views://` URL, so the main process hands the view the engine bundle's source and the view starts the worker from a Blob.
- The main process opens the window, reads the files in `data/` and runs R. It never simulates.
- There is no database. Data lives in JSON files; a running simulation lives in memory.

## Stack

| Layer | Choice |
|---|---|
| Desktop shell | [Electrobun](https://framework.blackboard.sh/electrobun/) 2 (system webview, WebKitGTK on Linux) |
| Build tool | Hutch (Electrobun's CLI: dependencies, bundling, dev server) |
| Main process | Bun runtime |
| Language | TypeScript everywhere in the app |
| Simulation drawing | Canvas 2D |
| Charts | uPlot 1.6.32 |
| Data analysis | R 4.5 |
| Look | Plain monospace, light and dark from the system setting |

## Layout

```
epidemica/
├── README.md
├── package.json
├── hutch.config.ts         tasks: install, dev, build, test, typecheck
├── hutch.lock              exact dependency versions
├── electrobun.config.ts    app name, main process, views
├── tsconfig.json
├── src/
│   ├── bun/index.ts        main process: window, RPC handlers, Rscript bridge
│   ├── shared/rpc.ts       RPC types shared by main process and webview
│   ├── shared/outbreak.ts  the data/*.json shape, rows to columns
│   ├── shared/importing.ts date format and id guesses for the import form
│   ├── mainview/           the UI: index.html, index.ts, style.css
│   │   ├── history.ts      History tab: outbreak picker, summary, source
│   │   ├── import.ts       History tab: the import form
│   │   └── chart.ts        cases and deaths panels (uPlot)
│   └── engine/             the simulation: types, engine, worker
├── r/
│   ├── install.R           installs the R packages
│   ├── common.R            write_outbreak(): the JSON shape every dataset uses
│   ├── fetch_*.R           one script per outbreak, writes data/<outbreak>.json
│   ├── parameters.R        serial interval, incubation, infectious period (epiparameter)
│   ├── import.R            checks a CSV of your own, writes data/<id>.json
│   ├── import-schema.json  Frictionless Table Schema import.R checks against
│   └── fit.R               called by the app: fits an outbreak, prints JSON
└── data/                   cleaned datasets (JSON); data/raw/ is not committed
```

## Getting started

Needs R 4.5 and Node.js (only for the first `npx`). Developed on Linux (WebKitGTK 4.1). The frictionless R package needs libcurl's headers (`sudo apt install libcurl4-openssl-dev` on Debian and Ubuntu).

Get Hutch, Electrobun's build tool. The npm package downloads it into `~/.hutch`:

```bash
npx electrobun@2.0.2 --version
ln -s ~/.hutch/npm/electrobun/2.0.2/linux-x64/bin/hutch ~/.local/bin/hutch
```

(Hutch's own installer, `curl -fsSL https://hutch.blackboard.sh/hutch/install.sh | sh`, refuses a `~/.hutch` the npm package already made, hence the link.)

Then, in this folder:

```bash
hutch run install             # JavaScript dependencies, from hutch.lock
Rscript r/install.R           # R packages
hutch run dev                 # builds, opens the app, rebuilds on save
hutch run test                # engine tests
hutch run typecheck           # TypeScript
```

The footer of the app shows whether the engine worker started and which R version answered.

Rebuild the datasets (run from this folder):

```bash
Rscript r/fetch_flu1918.R     # or any other fetch_*.R
```

## Roadmap

**Mid-term (upload Sunday 1 November 2026)**

- [x] README and project outline
- [x] App skeleton: window, History and Simulate tabs, R bridge, engine worker
- [x] R pipeline for the four outbreaks, with exploratory analysis
- [x] First History chart from `data/*.json`: cases and deaths in stacked panels with a shared time axis (two y-axes would make the scales look comparable when they are not)
- [x] Engine passes the SIR final-size test

**Final**

- [ ] Simulate dashboard: canvas, live chart, all dials
- [ ] Settings presets (defined in `src/engine/presets.ts`, not in the UI yet)
- [ ] R fits (R0, R(t)) for each outbreak, "Load from history" into the simulator
- [ ] Compare two outbreaks in History
- [x] Import your own CSV (History tab or `r/import.R`), with disease parameters from epiparameter
- [ ] Report, demo video, presentation

**If there is time**

- Age groups with their own fatality
- Several towns with travel between them
- Shareable scenario files

## Limitations

- The simulator is a teaching model. Agents walk at random; real people have homes, jobs and friends.
- Historic data is patchy. Old outbreaks were counted by hand, recent ones depend on how much testing was done, and reporting rules changed during COVID-19.
- Numbers are charted as the source published them, not corrected. Where a number is known to be a reporting artefact, the dataset carries an annotation and the chart marks that date (for example the COVID-19 backlog of 2022-02-08).
- R0 fitted from early growth depends on the serial interval assumed, which is itself an estimate. epiparameter picks one published estimate per disease; another study can give a quite different value (mpox: 5.6 or 8.5 days).

## AI use

Parts of this project are built with an AI assistant (Claude Code). What it was used for, and what was checked or rewritten by hand, is recorded in the personal portfolio, as the semester guide asks.
