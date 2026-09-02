"""Shared loading of the graph, street KD-tree and DEM."""
import pickle, numpy as np
from scipy.spatial import cKDTree
from graph import StreetGraph, ll_to_xy, xy_to_ll   # StreetGraph needed to unpickle
from snap import Snapper
import __main__
__main__.StreetGraph = StreetGraph  # pickle was written from a __main__ context

_C = {}

def load():
    if _C: return _C
    g = pickle.load(open('data/sf_graph.pkl', 'rb'))
    keep = pickle.load(open('data/keep.pkl', 'rb'))
    P = np.load('data/dens_pts.npy')
    dem = np.load('data/sf_dem.npz')
    _C.update(g=g, keep=keep, tree=cKDTree(P), sn=Snapper(g, keep),
              dem_lat=dem['lats'], dem_lon=dem['lons'], dem_z=dem['z'])
    return _C

def elev_ft(lat, lon):
    """Bilinear sample of the 10 m DEM, in feet."""
    c = load()
    la, lo, z = c['dem_lat'], c['dem_lon'], c['dem_z']
    fi = np.clip((np.asarray(lat) - la[0]) / (la[1] - la[0]), 0, len(la) - 1.001)
    fj = np.clip((np.asarray(lon) - lo[0]) / (lo[1] - lo[0]), 0, len(lo) - 1.001)
    i0 = fi.astype(int); j0 = fj.astype(int)
    ti = fi - i0; tj = fj - j0
    def Z(i, j): return z[np.clip(i, 0, len(la)-1), np.clip(j, 0, len(lo)-1)]
    v = (Z(i0, j0)*(1-ti)*(1-tj) + Z(i0+1, j0)*ti*(1-tj) +
         Z(i0, j0+1)*(1-ti)*tj + Z(i0+1, j0+1)*ti*tj)
    return v * 3.280839895
