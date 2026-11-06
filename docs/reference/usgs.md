# USGS earthquake data — reference for Faultline

Checked 2026-10-25 from the owner's Mac (USGS reachable); §3 and §3b extended 2026-10-27 (U11, U12). Legend: ✅ verified · ⚠️ verified from a
search excerpt of the official page (the page itself blocks scripted downloads) · ❓ not verified.

## 1. Endpoints ✅

Source: FDSN event web service docs <https://earthquake.usgs.gov/fdsnws/event/1/>

| Use | Request |
| --- | --- |
| One event (full detail, all products) | `GET https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=<id>&format=geojson` |
| Search (box, time, magnitude) | `GET …/query?format=geojson&starttime=…&endtime=…&minlatitude=…&maxlatitude=…&minlongitude=…&maxlongitude=…&minmagnitude=…&eventtype=earthquake&reviewstatus=reviewed&orderby=time` |
| Polling for changes | add `updatedafter=<ISO8601>` |
| Real-time feeds (summary) | `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/<level>_<period>.geojson` (updated every minute) — <https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php> |

Behaviour ✅ (FDSN docs + test 2026-10-25):

- `reviewstatus` accepts `automatic` or `reviewed` (default all).
- `eventtype=earthquake` filters out non-earthquake events (quarry blasts etc.).
- A **deleted** event queried by `eventid` returns **HTTP 409 Conflict** (unless `includedeleted`).
- An unknown event id returns **HTTP 404** (tested with a made-up id).
- `limit` max 20000. Times are ISO8601, UTC by default.

## 2. GeoJSON fields Faultline uses ✅

Source: GeoJSON summary format <https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php>

| Field | Type | Use |
| --- | --- | --- |
| `id` (feature) | string | preferred event id → `eventId = keccak256(utf8(id))` |
| `properties.ids` | string, comma-separated **with leading and trailing commas** (`,us…,gcmt…,`) | all associated ids → oracle's dedup ledger (D8) |
| `properties.sources`, `net`, `code` | string | provenance; `id = net + code` for the preferred origin |
| `properties.time` | long, **ms** since epoch | `observedAt = floor(time / 1000)` |
| `properties.updated` | long, **ms** | `usgsUpdatedAt = floor(updated / 1000)`; revision detection |
| `properties.mag` | decimal | `magnitudeX100` (parse the decimal string; no float maths) |
| `properties.magType` | string, lower case in data (`"mwc"`, `"mww"`, …) | must be in the terms list |
| `properties.status` | string | must be `"reviewed"` |
| `properties.type` | string | must be `"earthquake"` |
| `geometry.coordinates` | `[longitude, latitude, depth]`, depth in **km** | box check, depth limit |

Volatile fields to keep **out** of `dataHash`: `felt`, `cdi`, `mmi`, `alert`, `sig`, `url`, `detail`,
`tsunami`, `nst`, `dmin`, `rms`, `gap`, `products`.

## 3. `status` values ✅ / ❓

- `automatic` — computer solution, not reviewed by a seismologist. ✅ (FDSN `reviewstatus` docs)
- `reviewed` — reviewed by a seismologist. ✅
- `deleted` — event withdrawn; returned only with `includedeleted`; by id it gives HTTP 409. ✅
- **Time to `reviewed` (U12) — measured, no official SLA.** USGS publishes no deadline. NEIC describes its products as
  automatic first, reviewed quickly for rapid release, and reviewed again in the following weeks for the catalogue
  ([NEIC systems overview](https://www.usgs.gov/publications/national-earthquake-information-center-systems-overview-and-integration));
  the W-phase moment magnitude for M7+ is computed within ~25 min ([W phase source inversion](https://www.usgs.gov/publications/w-phase-source-inversion-moderate-large-earthquakes-1990-2010)).
  Measured 2026-10-27 with `query?eventid=<id>&format=geojson&includesuperseded=true` (returns every product
  version) on the 10 most recent M7+ events (2025-10 → 2026-10): the first `origin` version with
  `review-status: reviewed` appeared **0.1–1.0 h** after origin time in **10/10** events (5 times from `pt`, the
  Pacific Tsunami Warning Center, 5 times from `us`), and the first Mww moment tensor **0.3–1.1 h** after. All 10 are
  `reviewed` with `magType mww` today. So the 6 h cooling period (D13) and a 30-day production grace are far above
  what USGS needs for big quakes; magnitudes can still be revised later (the reason for the cooling period).
  Caveat: only product versions that ComCat still stores are visible; this is evidence, not a guarantee.

## 3b. Event ids, merges and the preferred id (U11) ✅ / ⚠️

- A ComCat event collects products from several contributors; `id` is the **preferred** id, `ids` lists every
  associated id. A USGS staff answer on the realtime-feed-users list: an event "may have multiple ids, but always has a
  preferred id. The preferred id is determined by the id assigned by the network with the preferred location (origin
  type product)", and "any of the ids from any contributor can be used to access that information"
  ([realtime-feed-users, 2015](https://geohazards.usgs.gov/pipermail/realtime-feed-users/2015-December/000041.html)). ⚠️ (2015 list post)
- Preferred products are chosen by weight: base 1, +5 same source as the event, +100 author in the authoritative
  region, +50 refers to an authoritative event; ties go to the most recent update
  ([ComCat products](https://earthquake.usgs.gov/data/comcat/products.php)). ✅
- Measured 2026-10-27: recent M7+ events carry ids from `pt`, `us` and `usauto` (e.g. `us6000u18k`:
  `,pt26282000,us6000u18k,usauto6000u18k,`), and `eventid=pt26282000` returns the feature with `id` `us6000u18k`. ✅
  For 5 of the 10 events above the first reviewed origin came from `pt`, so while that origin was preferred the
  preferred id was most likely the `pt…` id, and it changed when the `us` origin became preferred. ⚠️ inference — no
  USGS page states it.
- **Consequence for Faultline (D8):** the oracle must key every event by **all** its `ids`, map a record whose ids
  overlap a known event to the ORIGINAL eventId, and may look a record up by any of its ids.
- The FDSN `nodata` parameter defaults to **204** (empty result, no body); `404` is also a valid choice. A deleted
  event by `eventid` → `409 Conflict`; with `includedeleted` its `status` is `deleted`
  ([FDSN event service](https://earthquake.usgs.gov/fdsnws/event/1/)). The service caps results at 20,000 (`400`
  above that) and asks automated applications to prefer the real-time feeds where possible; no rate limit is published.

## 4. Moment-magnitude types ⚠️

Source: USGS "Magnitude Types" table <https://www.usgs.gov/programs/earthquake-hazards/magnitude-types>
(page returns HTTP 403 to scripts; content confirmed through a search excerpt of that page).

| magType | Meaning | Range | Authority order |
| --- | --- | --- | --- |
| `mww` | W-phase moment magnitude | ~M5.0+ | authoritative when computed |
| `mwc` | centroid moment tensor (long-period surface waves) | ~M5.5+ | only if no Mww |
| `mwb` | body-wave moment tensor (P and SH) | ~M5.5+, limited above ~M7.5 | only if no Mww, Mwc |
| `mwr` | regional moment tensor (0–10°) | small/medium, limited ~M7.0+ | regional |
| `mw` | generic moment magnitude (seen in historical / contributed catalogues) | — | ❓ no USGS row; keep in list because historical events (e.g. GCMT) use it |

All use `Mw = 2/3 · (log10(M0) − 16.1)` (M0 in dyne·cm). Terms list (owner-approved 2026-10-25): `["mww","mwc","mwb","mwr","mw"]`
. Non-moment types to reject: `ml`, `md`, `mb`, `ms`, `mb_lg`, `mi`/`mwp` ❓ (not
checked).

## 5. Real historical event for the demo ✅

2001-01-26 Bhuj (Gujarat): **`usp000a8ds`** — fetched live 2026-10-25.

| Field | Value |
| --- | --- |
| mag / magType | 7.7 / `mwc` |
| status / type | `reviewed` / `earthquake` |
| coordinates | `[70.232, 23.419, 16]` (lon, lat, depth km) |
| time / updated | `980479000500` / `1651259174319` (ms) |
| ids | `,usp000a8ds,choy20010126031640,gcmtm012601a,gcmt20010126031640,duputel012601a,atlas20010126031640,iscgem1763683,` |

Saved as `oracle/fixtures/real-usgs-usp000a8ds-*.geojson`. Re-verified on the live API on 2026-10-26
(`eventid=usp000a8ds` and a box search 22.5–24.5 N, 68.5–71.5 E, M ≥ 7, 2001-01-26: one result, this event;
the `dataHash` fields equal the saved fixture). With the D13 curve (7.0 → 0 bps, 8.0 → 10000 bps), M7.7
gives 7000 bps (70 %). The old placeholder 6.5 → 7.5 gave 100 %. **Never invent an id**; find others with the
search query above.

⚠️ **Replay timing problem:** the event's `observedAt` is in 2001, but the trigger only accepts
`riskStart <= observedAt <= now`. Decided: replay terms (docs/ARCHITECTURE.md §12 D10).

## 6. Second source (display only)

EMSC (<https://www.seismicportal.eu/fdsnws/event/1/>) — FDSN-compatible; ids and magnitudes differ
from USGS, so cross-check only (HANDOVER §7). ❓ not tested.
