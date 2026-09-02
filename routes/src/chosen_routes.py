"""The six chosen routes, all drawing the Anthropic A-mark.

Each entry: (source pickle, index, slug, display name, area, logo, tier).
`tier` is "short" for the under-10K set and "long" for the 6-10 mile set.
"""
CHOSEN = [
    # ---- short: under 10K -------------------------------------------------
    ("anth_mission",  0, "anthropic-mission", "Anthropic — Mission",
     "Mission District (24th Street)", "anthropic", "short"),
    ("anth_sunset",   0, "anthropic-outer-sunset", "Anthropic — Outer Sunset",
     "Outer Sunset", "anthropic", "short"),
    ("anth_nopa2",    0, "anthropic-panhandle", "Anthropic — NoPa & the Panhandle",
     "NoPa / Panhandle", "anthropic", "short"),
    # ---- long: 6 to 10 miles ----------------------------------------------
    ("lga_richmond",  2, "anthropic-richmond-long", "Anthropic — Inner Richmond",
     "Inner Richmond", "anthropic", "long"),
    ("a6_potrero",    0, "anthropic-potrero-long", "Anthropic — Mission & Potrero Flats",
     "Inner Mission / Potrero Flats", "anthropic", "long"),
    ("lg_anth_home",  0, "anthropic-lower-haight-long", "Anthropic — Lower Haight",
     "Lower Haight / Alamo Square", "anthropic", "long"),
]
VARIANT_KEY = "r12h0.26w0.68"


def load_choice(tag, idx):
    import pickle
    obj = pickle.load(open(f"out/cand/{tag}.pkl", "rb"))
    if isinstance(obj, dict):
        obj = obj[VARIANT_KEY]
    return obj[idx]
