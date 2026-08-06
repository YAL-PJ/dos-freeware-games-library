# DOS Freeware Games Library

This repository is the canonical DOS game-data repository used by **CPlay**. It keeps a machine-readable catalog, downloadable [js-dos](https://js-dos.com/) bundles, the automation that refreshes both, and a small browser-based catalog viewer in one versioned place.

It is a content repository rather than the CPlay player itself. CPlay consumes the records in `library.json` and opens the bundle URL attached to a playable record. The actual DOS program files and the js-dos/DOSBox launch configuration live inside the corresponding file under `bundles/`.

## Why this repository exists

Keeping the library separate from CPlay allows catalog and game-bundle updates to be committed independently of the player application. It also provides stable, reviewable artifacts:

- `library.json` is the index a consumer can fetch.
- `bundles/<id>.jsdos` is the downloadable artifact for a playable catalog entry.
- source URLs and source download URLs retain the provenance collected by the automation.
- metadata-only records let the catalog retain a discovered game when a usable bundle could not be produced.

“Freeware” and “shareware” in this repository are source metadata. Their presence is not an independent rights audit or a guarantee that every artifact will run correctly.

## Architecture

```text
DOS Games Archive freeware/shareware pages
                    │
                    ▼
        library-bot scraper (Cheerio)
                    │
              work/catalog.json
                    │
                    ▼
      downloader + launcher detection
                    │
         ┌──────────┴──────────┐
         ▼                     ▼
  bundles/<id>.jsdos   work/bundle-manifest.json
         │                     │
         └──────────┬──────────┘
                    ▼
               library.json
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
        CPlay          optional webapp viewer
```

There are four main layers:

1. **Catalog data** — `library.json` contains one JSON object per discovered title. Each record includes identity and display metadata, source provenance, bundle state, tags, and (when available) a raw GitHub bundle URL.
2. **Game artifacts** — each `.jsdos` file is a ZIP-compatible archive. The builder places source archive contents below `GAME/` and writes `.jsdos/dosbox.conf`, whose `[autoexec]` section mounts the archive, changes to `GAME`, and runs a detected launcher.
3. **Maintenance automation** — the Node.js scripts scrape catalog pages, download source ZIPs, detect launchers, build bundles, generate the public catalog, copy artifacts into the repository, and patch existing bundles.
4. **Catalog viewer** — `webapp/` is a dependency-free static HTML/CSS/JavaScript interface over `library.json`. It is supporting tooling, not an emulator.

## Repository structure

| Path | Purpose |
| --- | --- |
| `library.json` | Committed public catalog consumed by CPlay and the included viewer. |
| `bundles/` | Committed `.jsdos` archives containing game files and DOSBox configuration. |
| `library-bot/src/` | Scraping, bundle building, catalog generation, publishing, patching, and shared utilities. |
| `library-bot/templates/dosbox.conf` | Base DOSBox configuration inserted into generated and patched bundles. |
| `library-bot/seeds/starter-catalog.json` | Small fallback catalog used only when a full scrape fails. |
| `library-bot/work/` | Ignored intermediate catalog and bundle manifest output. |
| `library-bot/dist/` | Ignored local bundle build output. |
| `webapp/` | Static catalog browser and CPlay launch integration. |
| `.github/workflows/library-bot.yml` | Scheduled and manually dispatchable catalog refresh workflow. |
| `.github/workflows/patch-bundles.yml` | Manually dispatchable in-place bundle patch workflow. |

## Catalog contract

`library.json` is a JSON array. Generated records have the following fields:

| Field | Meaning |
| --- | --- |
| `id` | Slug used as the record identifier and bundle filename stem. |
| `title`, `year`, `genre`, `category` | Display and classification metadata scraped from the source. `year` may be `null`. |
| `license` | Source classification, currently `Freeware` or `Shareware`. |
| `source` | Source key; the implemented scraper writes `dosgamesarchive`. |
| `sourceUrl` | Game detail page used as provenance. |
| `sourceDownloadUrl` | Resolved source archive URL. |
| `screenshot` | Remote screenshot URL, or an empty string. Images are not stored here. |
| `metadataOnly` | `true` when no downloadable bundle is exposed by the record. |
| `status` | Build outcome such as `bundled`, `installer-only`, or `failed`. |
| `downloadUrl` | Bundle URL for a bundled record; otherwise an empty string. |
| `tags` | Source-generated descriptive strings. |

Consumers should use `downloadUrl` (or `metadataOnly`) rather than infer availability from a filename. A `.jsdos` file can remain in `bundles/` without being referenced by the current catalog.

## Implemented functionality

### Discovery and catalog reuse

The scraper currently targets only the Freeware and Shareware listings at DOS Games Archive. It discovers every pagination page, visits each new detail page, extracts the title, first category, year, screenshot, and first downloadable file, then deduplicates records by generated slug. Records whose `sourceUrl` already exists in `library.json` are reused instead of being scraped again.

If the scrape throws, the all-in-one runner falls back to the six-record starter seed. Failures on individual listing or detail pages are logged and skipped.

### Bundle creation

For an entry with a source download URL, the builder:

1. downloads the archive and opens it as ZIP data;
2. looks for a root or first-level-subdirectory launcher, preferring browser-specific `*web.bat`, `START.BAT`, other batch files, game executables, and then COM files;
3. rejects an archive when only a known installer/utility or no recognized launcher is found;
4. creates the required `GAME/` directory tree and copies the source files into it;
5. adds `.jsdos/dosbox.conf` with the detected startup commands; and
6. writes the `.jsdos` bundle and manifest entry.

Already known source pages reuse an existing bundle when its expected file is present. Bundled records from the prior catalog are also preserved when a scrape temporarily omits them and their bundle remains on disk.

### Bundle patching

The patcher works on committed bundles without downloading the original sources. It can:

- regenerate the launcher in `dosbox.conf`;
- add directory entries needed by the js-dos WASM extractor;
- translate selected `cycles`, `aspect`, and `scaler` batch commands to `config -set` forms;
- adjust several hard-coded absolute driver paths for the `GAME/` layout;
- resolve a specific DOS Games Archive `WEB.BAT`/`SH.BAT` launcher pattern; and
- unpack self-extracting ZIP executables only when the resulting file list has a detectable playable launcher.

### Static catalog viewer

The viewer loads `../library.json` by default. A caller can override the catalog with `?library=<URL>` or send a `loadLibrary` message containing a URL. It implements search; genre, decade, license, and availability filters; four sort orders; 50-record pagination; source links; and random selection.

For a playable record, the viewer normally opens CPlay (defaulting to `https://playdosgames.xyz/`) with the bundle URL in its `bundle` query parameter. `?cplay=<URL>` overrides that destination. The code also defines iframe messages for loading a library, launching a game, and closing the library, although the configured CPlay URL means normal launches take the URL-based path first.

No hosting or deployment workflow for `webapp/` is included in this repository.

## Technologies

- **Data and artifacts:** JSON and ZIP-compatible `.jsdos` bundles
- **Automation runtime:** Node.js 20 in GitHub Actions, using ECMAScript modules
- **Bot dependencies:** Cheerio, `slugify`, and `adm-zip`
- **Network access:** built-in `fetch`, with `curl` fallback
- **Emulation configuration:** DOSBox configuration packaged for js-dos
- **Viewer:** browser-native HTML, CSS, and JavaScript
- **Continuous automation:** GitHub Actions

## Update workflow

### Automated refresh

The **Library Bot** workflow runs daily at `03:15 UTC` and can also be started with `workflow_dispatch`. It checks out the repository, installs the bot dependencies, runs the complete scrape/build/generate pipeline, stages `library.json` and `bundles/`, and pushes a commit only when those paths changed.

The pipeline uses this default sequence:

```text
scrape -> build bundles -> copy bundles -> generate library.json
```

The workflow sets `CPLAY_BUNDLE_BASE_URL` to the `main` branch's raw GitHub `bundles/` directory, so generated `downloadUrl` values point there.

### Manual local operation

Prerequisite: Node.js and npm. The workflow uses Node.js 20.

```bash
cd library-bot
npm install

# Complete scrape, build, publish, and catalog generation
npm run run

# Scrape only; writes work/catalog.json
npm run scrape

# Build from work/catalog.json and regenerate library.json
npm run build

# Regenerate library.json from existing work files
npm run library

# Patch every committed bundle in place
npm run patch
```

The runner also accepts environment overrides for catalog, work, distribution, catalog output, repository, bundle directory, and bundle-base paths: `CPLAY_CATALOG_PATH`, `CPLAY_WORK_DIR`, `CPLAY_DIST_DIR`, `CPLAY_LIBRARY_JSON`, `CPLAY_LIBRARY_REPO_PATH`, `CPLAY_BUNDLES_DIR`, and `CPLAY_BUNDLE_BASE_URL`.

Review generated diffs before committing. In particular, the patch command rewrites bundle archives in place and a failed scrape may cause the starter seed to become the input to a full run.

### Manual bundle patch workflow

The **Patch Bundles** workflow is dispatch-only. It installs the same dependencies, runs `npm run patch`, stages `bundles/`, and pushes a commit if archive contents changed. It deliberately checks out with Git LFS download disabled; no Git LFS configuration is present in this repository.

## Limitations and operational cautions

- Discovery is tied to the current HTML structure and URL patterns of one third-party site. Selector or download-flow changes can reduce or stop discovery.
- License values are copied from the source listing. The bot's allowlist checks labels; it does not perform legal review of each game or archive.
- Bundle construction expects downloaded content that `adm-zip` can read. Other archive formats, unusual installers, nested layouts beyond the detection rules, and launchers deeper than one subdirectory may fail or be classified as metadata-only.
- Launcher selection is heuristic. Finding an EXE, COM, or batch file does not prove that a game boots, accepts input, has working sound, or is otherwise playable.
- The generated public catalog does not retain the builder's detailed `failureReason`; consumers receive only `status` and `metadataOnly` for failed or installer-only records.
- Existing records are reused by source URL, so changed upstream metadata or downloads are not refreshed automatically while that URL remains in the catalog.
- The workflows commit directly to the checked-out branch and have no validation/test step before pushing.
- Bundles are large binary files stored directly in Git. The catalog distributes them through `raw.githubusercontent.com`; there is no release, checksum, mirror, or availability mechanism in the codebase.
- Remote screenshots and all upstream downloads depend on third-party availability.
- The static viewer does not emulate DOS games itself and contains no deployment configuration.
- The repository has no automated test suite, catalog schema file, bundle checksum manifest, or documented compatibility guarantee.
- No repository-level license file defines terms for the maintenance code or repository contents.

## Relationship to CPlay

The boundary is intentionally simple: this repository publishes data and artifacts; CPlay consumes and runs them. A CPlay integration should fetch `library.json`, display or otherwise select a record, ignore records without a `downloadUrl` when playability is required, and pass the selected `.jsdos` URL to its player. Changes to the catalog format, bundle layout, raw-file base URL, or DOSBox autoexec behavior are therefore integration changes and should be reviewed with CPlay compatibility in mind.
