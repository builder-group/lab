# Project model

The pure boundary is `src/modules/project/model/index.ts`: `prepareProject`, `SCommands`, `executeCommands` and derivations. Both UI and agent proposals use it. See [architecture](architecture.md) for persistence and the shared write path.

## Records and capabilities

A Part is a product or material record with notes, sources, user properties and optional typed capabilities. Its build state is `wishlist`, `in-build` or `archived`, independent of canvas usage or purchase state. Ordered `sections` control presentation; hiding a section does not delete capability data.

Capabilities describe behavior such as dimensions, appearance, electrical terminals and cable/linear material specifications. Tags are user labels and do not drive calculations. Known capabilities have their own validated schema families. Unknown versioned capabilities survive loading/saving but cannot power known calculations. Keep new domains composable so one part can eventually carry both electrical and fluid interfaces.

A library entry is prefilled data, not a React component. A linked project part retains a pinned definition, local edits and persistent origin. Three-way updates preserve overrides and stable port IDs. Detaching stops synchronization while retaining origin and project facts. A used port cannot disappear without explicit connection reconciliation in the same command batch.

An Instance is a physical discrete unit. A Placement gives it one canonical millimetre position on a layout; x/y is the top-left of its rotated axis-aligned bounds. Unplacing retains the part, instance, purchases and connections. Missing geometry makes route-derived length unresolved; entered manual/measured lengths remain available.

A Run is one physical cable, with separate logical conductor/core mappings. Its material length is counted once, including `extraLengthM`, regardless of core count. Moving equipment updates route endpoints and route-derived demand while preserving manual/measured base lengths. A linear Part's explicit `quantity` adds demand beyond active runs.

## Requirements, purchases and stock

Keep these quantities distinct:

- Required demand comes from selected parts and active runs.
- Planned allowance is an optional procurement target above demand.
- Purchase pack size rounds purchases to whole packs.
- Purchases record commercial facts; received stock pieces record continuous physical lengths.
- Planned allocations reserve stock; cuts and waste consume it.

Need 12 m with 3 m owned and 10 m packs: buy one additional pack, not two. Need 6 m with a 10 m allowance and 10 m bought: no further purchase is required. Consuming stock does not automatically replenish allowance.

Received totals without a piece breakdown cover quantity and budget but do not prove continuous usable rolls. One continuous run needs one sufficiently long cut; summing short fragments cannot fulfill it. A cut consumes matching reservations. Integrity checks prevent over-allocation, over-cutting or shortening a piece below consumption. Allocation is an estimate, not a global cutting optimizer.

Quotes are dated seller observations with pack quantities. `estimatedUnitPrice` is the explicit planning estimate per base unit. Purchases remain spending even when a part becomes wishlist or archived. Unknown prices/lengths remain unknown: `requiredQuantityComplete`, `unknownRequirementCount`, `knownEstimate` and `forecastComplete` support honest partial totals.

## Versioning and findings

The persisted contract is `yadori/project@3`, validated and migrated with Zod and versjon. Version 1 migrates to explicit `purchasePackQuantity` and `libraryOrigin` at version 2; version 2 migrates to nullable run `sizing` at version 3. Preserve IDs, revision, source values and unknown optional capabilities. Do not infer electrical assumptions during migration. Current documents are strict; future root versions are rejected.

Findings compare entered specifications and unresolved facts. They do not infer a complete series bank's voltage or certify installation safety. [DC sizing](dc-cable-sizing.md) covers explicit voltage-drop inputs; thermal ampacity and protection remain separate. Artwork calibration provenance is a validated `yadori/artwork-calibration@1` capability and must not manufacture missing terminal coordinates.
