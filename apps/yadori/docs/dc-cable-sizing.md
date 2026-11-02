# DC voltage-drop sizing

`src/modules/electrical/dc-sizing.ts` estimates the conductor area needed to meet an entered DC voltage-drop target. Inputs are supply voltage, current, one-way length, conductor material, assumed conductor temperature and allowed drop. It also evaluates the selected cable section. Missing inputs remain incomplete; AC and signal cables are unsupported.

## Calculation

```text
ρT = ρ20 × [1 + α20 × (T − 20°C)]
Lloop = Lone-way × roundTripFactor
ΔVmax = voltage × allowedDropPercent / 100
Amin = current × ρT × Lloop / ΔVmax
ΔVselected = current × ρT × Lloop / Aselected
```

The recommendation rounds up to a supported metric section from 0.5 to 240 mm². Above that range it returns no recommendation.

Factor 2 assumes an equal-length, equal-section, same-material return. Factor 1 evaluates the entered conductor alone and excludes return loss. The multiplier affects electrical resistance, never purchased material demand. A separately drawn positive and negative run each count their own physical length. One-way input includes explicit run allowance; manual/measured lengths remain fixed when equipment moves.

| Material         | ρ20 (Ω·mm²/m) | α20 (/°C) |
| ---------------- | ------------- | --------- |
| Copper           | 1/58          | 0.00393   |
| EC-H19 aluminium | 0.028264      | 0.00403   |

These are idealized reference materials. Strand lay, alloys, plating and actual product resistance differ. Temperature is an explicit conductor assumption, not a calculated thermal result; the supported input range is -20 to 105°C.

For 12 V, 10 A, 5 m one-way, equal return, copper at 20°C and a 3% target: the loop is 10 m, allowed drop 0.36 V, minimum section 4.789 mm² and standard recommendation 6 mm². The selected 6 mm² section drops approximately 0.287 V / 2.395%, excluding connection resistance.

## Boundaries

Passing voltage drop does not establish thermal ampacity, fuse coordination, terminal suitability, grouping, installation method or manufacturer minimums. Entered cable current ratings are compared separately. Proposed UI defaults leave voltage/current unknown and require user refinement.

Applying a recommendation selects or creates a separate material specification for the run; it must not silently change other runs using a shared material or inherit unsupported commercial/rating facts. Unknown length and price keep requirement/cost totals explicitly incomplete.

## References

- [Victron Wiring Unlimited: theory](https://www.victronenergy.com/media/pg/The_Wiring_Unlimited_book/en/theory.html) and [DC wiring](https://www.victronenergy.com/media/pg/The_Wiring_Unlimited_book/en/dc-wiring.html): resistance, complete circuit length, voltage drop and manufacturer guidance.
- [NBS/NIST Handbook 100: Copper Wire Tables](https://nvlpubs.nist.gov/nistpubs/Legacy/hb/nbshandbook100.pdf), appendix 5: standard annealed copper properties.
- [NBS/NIST Handbook 109: Aluminum Wire Tables](https://nvlpubs.nist.gov/nistpubs/Legacy/hb/nbshandbook109.pdf), table 1: EC-H19 aluminium properties.
