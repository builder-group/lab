"""The skin catalog: every built-in skin per element, free of themes, and what each theme dresses an element with.

`skin_catalog.json` is the one source; the app reads the same file (`skin-catalog.ts`). `resolve_look` mirrors
`resolveSkinLook` in skin-catalog.ts: `blender/tests/skin_look_cases.json` holds cases both sides are tested against.

`hidden` skins stay built and off the app's tiles unless a project uses them.
"""
import json
from pathlib import Path

CATALOG = json.loads(Path(__file__).with_name('skin_catalog.json').read_text())
ELEMENTS = CATALOG['elements']
THEME_PARTS = CATALOG['themes']
_SKINS = {skin['id']: skin for element in ELEMENTS.values() for skin in element['skins']}
PART_FIELDS = ('colorSource', 'onHit', 'glowColor', 'variant')


def element_of(piece_type):
    return piece_type if piece_type in ELEMENTS else 'platform'


def clean_parts(parts):
    """The parts of a scene description's `themeParts` that name a known element"""
    return {element: dict(part) for element, part in (parts or {}).items() if element in ELEMENTS and isinstance(part, dict)} if isinstance(parts, dict) else {}


def resolve_look(base, parts, element, component=None):
    """What a piece of `element` wears: its own skin or the theme's, with each property from its own override, the
    theme's part (only while it shows the theme's skin) or the skin's default.

    Returns skin (id), isThemeSkin, colorSource, onHit (None keeps the theme's reaction), glowColor, variant, properties."""
    element = element_of(element)
    theme = THEME_PARTS.get(base) or THEME_PARTS['pegboard']
    part = (parts or {}).get(element) or {}
    part_skin = part.get('skin') if _fits(part.get('skin'), element) else theme[element]
    component = component if isinstance(component, dict) else {}
    own = component.get('assetId')
    own = own if _fits(own, element) else None
    skin = own or part_skin
    is_theme = own is None or own == part_skin
    entry = _SKINS[skin]

    def choose(field):
        value = component.get(field)
        if value is not None:
            return value
        return part.get(field) if is_theme else None

    color_source = choose('colorSource')
    variant = choose('variant')
    variants = [item['id'] for item in entry.get('variants', [])]
    on_hit = choose('onHit')
    return {
        'skin': skin,
        'isThemeSkin': is_theme,
        'colorSource': color_source if color_source in entry['colorSources'] else entry['colorSource'],
        'onHit': on_hit if on_hit in ELEMENTS[element]['onHit'] else None,
        'glowColor': choose('glowColor'),
        'variant': variant if variant in variants else entry.get('variant'),
        'properties': dict(component.get('properties') or {}),
    }


def _fits(skin_id, element):
    return isinstance(skin_id, str) and skin_id in _SKINS and skin_id.split(':', 1)[0] == element
