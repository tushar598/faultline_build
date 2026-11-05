# Oracle fixtures

Every file here must say in its name whether it is **real** or **synthetic** (`scripts/lib/fixtures.ts` refuses any
other name). These four files were copied unchanged from the reference repo (`~/Desktop/faultline/oracle/fixtures`);
more fixtures come with the oracle part.

| File | Kind | Source / content |
| --- | --- | --- |
| `real-usgs-usp000a8ds-detail.geojson` | **real** USGS record | `GET https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=usp000a8ds&format=geojson` (saved by the reference repo on 2026-10-25) |
| `synthetic-kutch-1.geojson` | **SYNTHETIC**, not a real USGS event | M7.2 `mww`, reviewed, 23.30 N 70.55 E, depth 10 km, time = Bhuj + 200 days; 2000 bps under D13 |
| `synthetic-kutch-2.geojson` | **SYNTHETIC**, not a real USGS event | M7.5 `mww`, reviewed, 23.60 N 69.90 E, depth 10 km, time = Bhuj + 20 days; 5000 bps |
| `synthetic-kutch-3.geojson` | **SYNTHETIC**, not a real USGS event | M7.3 `mww`, reviewed, 23.10 N 70.80 E, depth 10 km, time = Bhuj + 25 days; 3000 bps |

Event `usp000a8ds` is the 2001-01-26 Bhuj (Gujarat) earthquake: M7.7, `magType: "mwc"`, `status: "reviewed"`,
`type: "earthquake"`, depth 16 km, epicentre 23.419 N 70.232 E, origin time `980479000500` ms, `updated`
`1651259174319` ms. USGS data is in the US public domain. Re-fetch before a demo: `updated` may change.

The `synthetic-kutch-*` files use ids `synthetic-kutch-N`, `net: "synthetic"`, and a `place`/`title` that say "not a
real USGS event". Their times are offsets from the real Bhuj origin time, so one replay offset (D10) puts every event
inside a local bond's risk period. They contain no addresses, accounts or ids from any deployment.
