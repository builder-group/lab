# Library artwork

Library entries are versioned data in `src/modules/library/data/catalog.v1.json`. The adjacent `assets.json` records stable asset IDs, file paths, source URLs and attribution; `artwork-calibration.v2.json` records physical envelopes, variant qualifications, source transforms and hashes. Treat those records as the detailed inventory rather than duplicating dimensions in documentation.

## Attribution

The flat library includes WireElectric-hosted illustrations with Victron branding and derivatives of official Victron dimension drawings. Public availability does not establish a redistribution licence. Preserve attribution and source evidence; review artwork rights before distributing the app publicly. Generic schematic symbols are original Yadori artwork and are explicitly illustrative.

- [WireElectric catalog](https://app.wireelectric.nl/api/v1/catalog/components): source illustration URLs and variant terminal landmarks.
- [Victron product downloads](https://www.victronenergy.com/support-and-downloads/technical-information): manufacturer documentation and dimension drawings; exact URLs are attached to each asset/calibration record.

Family illustrations can differ from an exact model's enclosure or label. The calibration metadata records those qualifications and any corrected rating text. Illustrative port landmarks are planning anchors, not manufacturer-certified terminal-centre CAD measurements. Hidden rear connectors or free leads retain unknown physical anchors.

## Changes

Manufacturer dimensions determine the displayed body envelope and projection. Crop an illustration to that envelope and transform its port anchors with the same body transform. At 100% canvas zoom, one physical millimetre maps to one CSS pixel. A schematic symbol or uncalibrated image cannot supply a physical route measurement.

Asset bytes are immutable once referenced by a project. Replacing artwork requires a new asset ID and an explicit library revision with its appearance, dimensions and anchors updated together. Keep older asset identities available when existing library/project definitions still use them. Portable exports materialize the actual bytes; they do not depend on application bundle URLs.

Tests check vector contents, physical view boxes, calibration hashes, anchor transforms and known variant boundaries. Add source and calibration metadata with new library artwork instead of setting verification flags from appearance alone.
