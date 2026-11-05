# Oracle fixtures

Every file here must say in its name whether it is **real** or **synthetic**.

| File | Kind | Source |
| --- | --- | --- |
| `real-usgs-usp000a8ds-detail.geojson` | **real** USGS record | `GET https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=usp000a8ds&format=geojson`, fetched 2026-10-25 |
| `real-usgs-usp000a8ds-search.geojson` | **real** USGS search result (FeatureCollection) | `…/query?format=geojson&starttime=2001-01-25&endtime=2001-01-27&minmagnitude=7&minlatitude=20&maxlatitude=27&minlongitude=67&maxlongitude=73`, fetched 2026-10-25 |
| `synthetic-kutch-1.geojson` | **SYNTHETIC**, not a real USGS event | M7.2 `mww`, reviewed, 23.30 N 70.55 E, depth 10 km, time = Bhuj + 200 days; → 2000 bps under D13. Local e2e Flow B second event |
| `synthetic-kutch-2.geojson` | **SYNTHETIC**, not a real USGS event | M7.5 `mww`, reviewed, 23.60 N 69.90 E, depth 10 km, time = Bhuj + 20 days; → 5000 bps. Local e2e Flow C |
| `synthetic-kutch-3.geojson` | **SYNTHETIC**, not a real USGS event | M7.3 `mww`, reviewed, 23.10 N 70.80 E, depth 10 km, time = Bhuj + 25 days; → 3000 bps. Local e2e Flow C third event (Superseded) |
| `synthetic-kutch-3-revised-outside-box.geojson` | **SYNTHETIC**, not a real USGS event | revision of `synthetic-kutch-3` (same id, `updated` + 1 day) relocated to 23.10 N **72.00 E**, outside the box → the oracle's D15 advisory test |
| `synthetic-kutch-2-merged.geojson` | **SYNTHETIC**, not a real USGS event | `synthetic-kutch-2` merged under a new preferred id `synthetic-kutch-2b` (`ids` lists both), `updated` + 1 day, M7.5 → **M7.6** (6000 bps) → the oracle's D8 merge test (maps to the ORIGINAL eventId, revision nonce 2) |
| `synthetic-kutch-testnet-a.geojson` | **SYNTHETIC**, not a real USGS event | M7.5 `mww`, reviewed, 23.50 N 70.40 E, depth 12 km, time = Bhuj + **60 s**; → 5000 bps. Testnet full demo (HANDOVER §10 step 9) Flow A: attested by the oracle, then paused and vetoed by the trustee. Bhuj + 60 s so one replay offset puts both it and the real Bhuj record inside the short testnet risk period |
| `synthetic-*.geojson` | **synthetic**, shaped like USGS GeoJSON | written by hand for tests (automatic status, wrong magType, outside box, too deep, revisions, merged ids). Never presented as real |

Event `usp000a8ds` is the 2001-01-26 Bhuj (Gujarat) earthquake: M7.7, `magType: "mwc"`,
`status: "reviewed"`, `type: "earthquake"`, depth 16 km, epicentre 23.419 N 70.232 E,
origin time `980479000500` ms, `updated` `1651259174319` ms, `net: "us"`, `code: "p000a8ds"`,
associated ids `,usp000a8ds,choy20010126031640,gcmtm012601a,gcmt20010126031640,duputel012601a,atlas20010126031640,iscgem1763683,`.

Re-verified on the live USGS API on 2026-10-26 (02:08 IST): `eventid=usp000a8ds` returns the same `id`, `time`,
`updated`, `mag`, `magType`, `status`, `type`, `ids`, `net`, `code` and coordinates as the saved detail file,
and a search of the D13 box (22.5–24.5 N, 68.5–71.5 E, M ≥ 7, 2001-01-26) returns only this event.

USGS data is in the US public domain. Re-fetch before a demo: `updated` may change.

The `synthetic-kutch-*` files use ids `synthetic-kutch-N`, `net: "synthetic"`, a `place`/`title` that say "not a real
USGS event", and a top-level `"synthetic"` note. Their times are offsets from the real Bhuj origin time so the
replay offset (D10) puts every event inside the local bond's risk period. They are used only by the local e2e
(`scripts/lib/e2e.ts`, mock-tested, local only).
