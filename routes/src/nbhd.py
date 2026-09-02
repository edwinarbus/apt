"""Candidate drawing areas, chosen for flat terrain and usable street geometry."""
ANCHOR = (37.7712, -122.4335)   # Duboce Triangle, a neighbourhood-level anchor for 'start nearby'

# name -> (S, W, N, E)
AREAS = {
    "outer-sunset":   (37.7400, -122.5090, 37.7600, -122.4830),  # south of GG Park
    "inner-sunset":   (37.7495, -122.4790, 37.7640, -122.4545),
    "richmond":       (37.7735, -122.4930, 37.7865, -122.4550),
    "mission":        (37.7450, -122.4290, 37.7690, -122.4040),
    "panhandle-nopa": (37.7690, -122.4530, 37.7825, -122.4280),
    "lower-haight":   (37.7620, -122.4460, 37.7745, -122.4230),
    "dogpatch":       (37.7480, -122.4040, 37.7680, -122.3830),
    "marina":         (37.7950, -122.4520, 37.8080, -122.4270),
    "bayview":        (37.7250, -122.4030, 37.7440, -122.3760),
    "golden-gate-pk": (37.7630, -122.5110, 37.7760, -122.4530),
    "west-portal":    (37.7300, -122.4800, 37.7460, -122.4600),
    "excelsior":      (37.7180, -122.4400, 37.7350, -122.4150),
}
