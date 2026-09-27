"""Write public/assets/jiao_colliders.json from the parametric 筊 geometry.
Run with Blender's bundled python (needs numpy):  python3 export_colliders.py [k] [u_stride] [rows]"""
import sys, os, json
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jiao_geom


def inertia(v, faces):
    """Unit-density inertia tensor of a closed triangle mesh about the origin (Tonon 2004)."""
    I = np.zeros((3, 3))
    for fc in faces:
        for k in range(1, len(fc) - 1):
            a, b, c = v[fc[0]], v[fc[k]], v[fc[k + 1]]
            det = np.dot(a, np.cross(b, c))
            # covariance of the tetrahedron (0, a, b, c)
            C = np.zeros((3, 3))
            for i in range(3):
                for j in range(3):
                    C[i, j] = det / 120.0 * (2 * (a[i] * a[j] + b[i] * b[j] + c[i] * c[j])
                                               + a[i] * b[j] + a[j] * b[i] + a[i] * c[j] + a[j] * c[i]
                                               + b[i] * c[j] + b[j] * c[i])
            I += np.trace(C) * np.eye(3) - C
    return I


def export(k=14, u_stride=1, rows=8, density=650.0):
    v, f, rim, meta = jiao_geom.surface()
    vol, c = jiao_geom.volume_centroid(v, f)
    v = v - c
    # to the glTF / three.js frame (x, z, -y)
    M = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], dtype=float)
    Ib = inertia(v, f) * density
    It = M @ Ib @ M.T
    evals, evecs = np.linalg.eigh(It)
    if np.linalg.det(evecs) < 0:
        evecs[:, 0] *= -1
    segs = jiao_geom.hull_segments(v, meta, k=k, u_stride=u_stride, nrows=rows)
    hulls = [[[round(p[0], 6), round(p[2], 6), round(-p[1], 6)] for p in s] for s in segs]
    from math import sqrt
    R = evecs  # columns = principal axes
    # rotation matrix -> quaternion
    tr = R[0, 0] + R[1, 1] + R[2, 2]
    if tr > 0:
        S = sqrt(tr + 1.0) * 2
        q = [(R[2, 1] - R[1, 2]) / S, (R[0, 2] - R[2, 0]) / S, (R[1, 0] - R[0, 1]) / S, 0.25 * S]
    else:
        i = int(np.argmax([R[0, 0], R[1, 1], R[2, 2]])); j, kk = (i + 1) % 3, (i + 2) % 3
        S = sqrt(1.0 + R[i, i] - R[j, j] - R[kk, kk]) * 2
        q = [0, 0, 0, 0]
        q[i] = 0.25 * S; q[j] = (R[j, i] + R[i, j]) / S; q[kk] = (R[kk, i] + R[i, kk]) / S; q[3] = (R[kk, j] - R[j, kk]) / S
    mass = dict(mass=float(vol * density), principal=[float(x) for x in evals], frame=[float(x) for x in q], density=density)
    info = dict(volume=vol, H=jiao_geom.P["H"], flat_offset=float(c[2]), hulls=hulls, massProps=mass,
                note="origin = centre of mass; flat face at local y=-flat_offset (normal -Y); back toward +Y; length along X; outer edge toward -Z")
    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "assets", "jiao_colliders.json")
    with open(out, "w") as fh:
        json.dump(info, fh)
    return info


if __name__ == "__main__":
    a = [int(x) for x in sys.argv[1:]]
    info = export(*a)
    print("hulls", len(info["hulls"]), "points", sum(len(h) for h in info["hulls"]), info["massProps"])
