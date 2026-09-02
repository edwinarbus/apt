"""Contact sheet of candidate routes, drawn the way Strava frames them."""
import glob, os, pickle, sys
sys.path.insert(0, "src")
import numpy as np
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from ctx import load
from vismatch import vis_match

def sheet(items, out, ncol=5, cell=3.1, show_ideal=True):
    c = load(); g = c['g']
    n = len(items); nrow = (n + ncol - 1) // ncol
    fig, axes = plt.subplots(nrow, ncol, figsize=(cell*ncol, cell*1.12*nrow))
    axes = np.atleast_1d(axes).ravel()
    for ax in axes: ax.set_axis_off()
    for ax, (tag, r) in zip(axes, items):
        p = np.asarray(r['nodes']); X, Y = g.X[p], g.Y[p]
        if show_ideal:
            for q in [s['ideal'] for s in r['snapped']]:
                ax.plot(q[:,0], q[:,1], '-', color="#c8d6e5", lw=1.1, zorder=1)
        ax.plot(X, Y, color="#FC5200", lw=2.5, solid_capstyle="round",
                solid_joinstyle="round", zorder=2)
        ax.set_aspect('equal'); ax.set_axis_off()
        v = vis_match(np.c_[X, Y], [s['ideal'] for s in r['snapped']], r['width_ft'], tol_ft=95)
        r['iou95'] = v['iou']
        ax.set_title(f"{tag}\n{r['dist']:.2f}mi  {r['gain']:.0f}ft  w={r['width_ft']/5280:.2f}mi\n"
                     f"IoU {v['iou']*100:.0f}%  cov {v['cover']*100:.0f}%  prec {v['prec']*100:.0f}%",
                     fontsize=7.6)
    plt.tight_layout(); fig.savefig(out, dpi=115, facecolor="white"); plt.close(fig)
    return out

if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "*"
    items = []
    for fn in sorted(glob.glob(f"out/cand/{which}.pkl")):
        tag = os.path.basename(fn)[:-4].replace("claude_", "C:").replace("anth_", "A:")
        res = pickle.load(open(fn, "rb"))
        for i, r in enumerate(res[:3]):
            items.append((f"{tag} #{i}", r))
    print(len(items), "panels")
    sheet(items, sys.argv[2] if len(sys.argv) > 2 else "out/contact.png")
