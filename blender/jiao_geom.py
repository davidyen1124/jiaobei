"""Parametric geometry for one 筊 (divination block).

Blender frame: flat face on z=0 facing -Z, rounded back toward +Z,
crescent spine is an arc in the XY plane with its apex toward +Y.
Units: metres.
"""
import math
import numpy as np

# Medium temple 筊 (see research notes in README)
P = dict(
    L=0.108,        # tip-to-tip chord length (NTM specimen: 10.5-11.3 cm)
    W_out=0.0235,   # half width toward the outer (convex) edge at the middle
    W_in=0.0185,    # half width toward the inner (concave) edge at the middle
    H=0.0228,       # max thickness of ONE block (NTM: 2.2-2.6 cm)
    theta=math.radians(54),  # half angle of the spine arc
    taper_out=(2.5, 0.50),   # g(s) = (1-|s|^a)^b ; b=0.5 gives a round tip
    taper_in=(2.0, 0.56),
    taper_h=(2.3, 0.50),
    q=2.1,                   # cross-section superellipse exponent (2 = half ellipse)
)


def spine(s, p=P):
    rs = (p["L"] / 2) / math.sin(p["theta"])
    a = p["theta"] * s
    pos = np.stack([rs * np.sin(a), rs * np.cos(a)], -1)
    nrm = np.stack([np.sin(a), np.cos(a)], -1)
    return pos, nrm, rs


def taper(s, ab):
    a, b = ab
    return np.clip(1 - np.abs(s) ** a, 0, 1) ** b


def surface(ns=132, nu=44, p=P):
    """Return (verts, faces, rim_edges, meta) for a closed watertight solid."""
    # cosine spacing: dense near the tips / rim where curvature is high
    s = -np.cos(np.pi * np.arange(ns + 1) / ns)  # -1..1, includes tips
    u = -np.cos(np.pi * np.arange(nu + 1) / nu)  # -1..1, includes both rims
    s_in = s[1:-1]
    pos, nrm, rs = spine(s_in, p)
    hw_out = p["W_out"] * taper(s_in, p["taper_out"])
    hw_in = p["W_in"] * taper(s_in, p["taper_in"])
    hh = p["H"] * taper(s_in, p["taper_h"])

    verts = []
    idx_dome = np.zeros((len(s_in), nu + 1), dtype=int)
    idx_flat = np.zeros((len(s_in), nu + 1), dtype=int)
    q = p["q"]
    for i in range(len(s_in)):
        for j in range(nu + 1):
            uu = u[j]
            xy = pos[i] + nrm[i] * uu * (hw_out[i] if uu > 0 else hw_in[i])
            z = hh[i] * (1 - abs(uu) ** q) ** (1 / q)
            if j in (0, nu):
                z = 0.0
            idx_dome[i, j] = len(verts)
            verts.append((xy[0], xy[1], z))
    for i in range(len(s_in)):
        for j in range(nu + 1):
            if j in (0, nu):
                idx_flat[i, j] = idx_dome[i, j]  # shared rim vertex
            else:
                x, y, _ = verts[idx_dome[i, j]]
                idx_flat[i, j] = len(verts)
                verts.append((x, y, 0.0))
    # tips
    tip_pos, _, _ = spine(np.array([-1.0, 1.0]), p)
    tipA = len(verts); verts.append((tip_pos[0][0], tip_pos[0][1], 0.0))
    tipB = len(verts); verts.append((tip_pos[1][0], tip_pos[1][1], 0.0))

    faces = []
    n = len(s_in)
    for i in range(n - 1):
        for j in range(nu):
            a, b, c, d = idx_dome[i, j], idx_dome[i + 1, j], idx_dome[i + 1, j + 1], idx_dome[i, j + 1]
            faces.append((a, b, c, d))  # dome: outward (+z)
            a, b, c, d = idx_flat[i, j], idx_flat[i + 1, j], idx_flat[i + 1, j + 1], idx_flat[i, j + 1]
            faces.append((a, d, c, b))  # flat: outward (-z)
    for j in range(nu):
        faces.append((tipA, idx_dome[0, j], idx_dome[0, j + 1]))
        faces.append((tipA, idx_flat[0, j + 1], idx_flat[0, j]))
        faces.append((tipB, idx_dome[n - 1, j + 1], idx_dome[n - 1, j]))
        faces.append((tipB, idx_flat[n - 1, j], idx_flat[n - 1, j + 1]))

    rim = set()
    for i in range(n - 1):
        for j in (0, nu):
            rim.add(tuple(sorted((idx_dome[i, j], idx_dome[i + 1, j]))))
    for j in (0, nu):
        rim.add(tuple(sorted((tipA, idx_dome[0, j]))))
        rim.add(tuple(sorted((tipB, idx_dome[n - 1, j]))))

    meta = dict(s=s, u=u, s_in=s_in, idx_dome=idx_dome, idx_flat=idx_flat, tipA=tipA, tipB=tipB, rs=rs)
    return np.array(verts), faces, rim, meta


def volume_centroid(verts, faces):
    vol = 0.0
    c = np.zeros(3)
    for f in faces:
        for k in range(1, len(f) - 1):
            a, b, d = verts[f[0]], verts[f[k]], verts[f[k + 1]]
            v = np.dot(a, np.cross(b, d)) / 6.0
            vol += v
            c += v * (a + b + d) / 4.0
    return vol, c / vol


def hull_segments(verts, meta, k=12, u_stride=2, nrows=9):
    """Split the solid along the spine into k convex pieces (point clouds)."""
    s_in = meta["s_in"]; dome = meta["idx_dome"]; flat = meta["idx_flat"]
    nu = dome.shape[1] - 1
    edges = np.linspace(-1, 1, k + 1)
    segs = []
    for a, b in zip(edges[:-1], edges[1:]):
        rows = [i for i, sv in enumerate(s_in) if a - 1e-9 <= sv <= b + 1e-9]
        # make sure neighbouring pieces overlap by one row
        lo = max(min(rows) - 1, 0); hi = min(max(rows) + 1, len(s_in) - 1)
        pick = sorted(set(np.linspace(lo, hi, min(hi - lo + 1, nrows)).round().astype(int)))
        pts = []
        for i in pick:
            for j in list(range(0, nu + 1, u_stride)) + [nu]:
                pts.append(verts[dome[i, j]])
                pts.append(verts[flat[i, j]])
        if a <= -1 + 1e-9:
            pts.append(verts[meta["tipA"]])
        if b >= 1 - 1e-9:
            pts.append(verts[meta["tipB"]])
        segs.append(np.unique(np.round(np.array(pts), 6), axis=0))
    return segs
