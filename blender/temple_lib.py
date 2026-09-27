"""Materials and geometry helpers for the temple scene (Cycles)."""
import bpy, bmesh, math, random
from mathutils import Vector, Matrix, Euler

FONT_DIR = "/System/Library/AssetsV2/com_apple_MobileAsset_Font8"
FONTS = {
    "kai": FONT_DIR + "/5f4c23e4a0c7b70597730d79e252955e973ead7d.asset/AssetData/BiauKai.ttc",
    "li": FONT_DIR + "/a304e3396d019087ab67af77f5e398977529007d.asset/AssetData/Libian.ttc",
    "xing": FONT_DIR + "/13b8ce423f920875b28b551f9406bf1014e0a656.asset/AssetData/Xingkai.ttc",
    "song": "/System/Library/Fonts/Supplemental/Songti.ttc",
}
_font_cache = {}


def font(name):
    if name not in _font_cache:
        _font_cache[name] = bpy.data.fonts.load(FONTS[name])
    return _font_cache[name]


# ------------------------------------------------------------------ node utils

def sock(node, ident, out=False):
    coll = node.outputs if out else node.inputs
    for s in coll:
        if s.identifier == ident:
            return s
    for s in coll:
        if s.name == ident and s.enabled:
            return s
    raise KeyError(f"{node.bl_idname}: {ident} in {[x.identifier for x in coll]}")


class NT:
    """Tiny node-tree builder. n(kind, **inputs) where inputs are values or sockets."""

    def __init__(self, tree, clear=True):
        self.t = tree
        if clear:
            tree.nodes.clear()

    def n(self, kind, **inputs):
        node = self.t.nodes.new(kind)
        for k, v in inputs.items():
            if k.startswith("_"):
                setattr(node, k[1:], v)
                continue
            s = sock(node, k)
            if isinstance(v, bpy.types.NodeSocket):
                self.t.links.new(v, s)
            else:
                s.default_value = v
        return node

    def link(self, a, b):
        self.t.links.new(a, b)

    def math(self, op, a, b=0.0, c=0.0):
        m = self.t.nodes.new("ShaderNodeMath"); m.operation = op
        for i, v in enumerate((a, b, c)):
            if isinstance(v, bpy.types.NodeSocket):
                self.t.links.new(v, m.inputs[i])
            else:
                m.inputs[i].default_value = v
        return m.outputs[0]

    def mix(self, fac, a, b, blend="MIX", kind="RGBA"):
        m = self.t.nodes.new("ShaderNodeMix"); m.data_type = kind; m.blend_type = blend
        suf = {"RGBA": "Color", "FLOAT": "Float", "VECTOR": "Vector"}[kind]
        for ident, v in (("Factor_Float", fac), (f"A_{suf}", a), (f"B_{suf}", b)):
            s = sock(m, ident)
            if isinstance(v, bpy.types.NodeSocket):
                self.t.links.new(v, s)
            else:
                s.default_value = v
        return sock(m, f"Result_{suf}", out=True)

    def ramp(self, fac, stops, interp="LINEAR"):
        r = self.t.nodes.new("ShaderNodeValToRGB")
        r.color_ramp.interpolation = interp
        cr = r.color_ramp
        while len(cr.elements) < len(stops):
            cr.elements.new(0.5)
        for el, (pos, col) in zip(cr.elements, stops):
            el.position = pos
            el.color = col if len(col) == 4 else (*col, 1)
        self.link(fac, r.inputs["Fac"])
        return r.outputs["Color"]

    def maprange(self, v, a, b, c=0.0, d=1.0, clamp=True):
        m = self.n("ShaderNodeMapRange", Value=v)
        m.inputs["From Min"].default_value = a; m.inputs["From Max"].default_value = b
        m.inputs["To Min"].default_value = c; m.inputs["To Max"].default_value = d
        m.clamp = clamp
        return m.outputs["Result"]


def new_mat(name):
    m = bpy.data.materials.new(name)
    t = NT(m.node_tree)
    out = t.n("ShaderNodeOutputMaterial")
    return m, t, out


def principled(t, out, **kw):
    b = t.n("ShaderNodeBsdfPrincipled")
    for k, v in kw.items():
        s = b.inputs[k]
        if isinstance(v, bpy.types.NodeSocket):
            t.link(v, s)
        else:
            s.default_value = v
    t.link(b.outputs["BSDF"], out.inputs["Surface"])
    return b


# ------------------------------------------------------------------ materials

def mat_granite(name="granite", joints=True):
    """Grey granite slabs, 60 cm, honed, polished by feet along the centre."""
    m, t, out = new_mat(name)
    tc = t.n("ShaderNodeTexCoord")
    V = tc.outputs["Object"]
    brick = t.n("ShaderNodeTexBrick", Vector=V, Scale=1.0, **{"Mortar Size": 0.0035, "Mortar Smooth": 0.25,
                "Brick Width": 0.6, "Row Height": 0.6, "Bias": 0.0})
    brick.offset = 0.0; brick.squash = 1.0
    sock(brick, "Color1").default_value = (0, 0, 0, 1)
    sock(brick, "Color2").default_value = (1, 1, 1, 1)
    sock(brick, "Mortar").default_value = (0.5, 0.5, 0.5, 1)
    slab_rand = t.n("ShaderNodeSeparateColor", Color=brick.outputs["Color"]).outputs[0]
    mortar = brick.outputs["Fac"] if joints else t.math("MULTIPLY", brick.outputs["Fac"], 0.0)
    # speckled grains, two scales
    v1 = t.n("ShaderNodeTexVoronoi", Vector=V, Scale=260.0, Randomness=1.0)
    v2 = t.n("ShaderNodeTexVoronoi", Vector=V, Scale=720.0, Randomness=1.0)
    g1 = t.n("ShaderNodeSeparateColor", Color=v1.outputs["Color"]).outputs[0]
    g2 = t.n("ShaderNodeSeparateColor", Color=v2.outputs["Color"]).outputs[0]
    stops = [(0.0, (0.068, 0.073, 0.082)), (0.45, (0.108, 0.113, 0.122)), (0.78, (0.165, 0.168, 0.175)),
             (0.90, (0.29, 0.29, 0.295)), (0.93, (0.012, 0.012, 0.014))]
    c1 = t.ramp(g1, stops, "CONSTANT")
    c2 = t.ramp(g2, stops, "CONSTANT")
    cloud = t.n("ShaderNodeTexNoise", Vector=V, Scale=3.0, Detail=6.0, Roughness=0.55)
    col = t.mix(0.45, c1, c2)
    col = t.mix(t.maprange(cloud.outputs["Fac"], 0.35, 0.7, 0.0, 0.35), col, (0.055, 0.06, 0.068, 1))
    # sparse large crystals: pinkish feldspar and black biotite clusters
    v3 = t.n("ShaderNodeTexVoronoi", Vector=V, Scale=95.0, Randomness=1.0)
    g3 = t.n("ShaderNodeSeparateColor", Color=v3.outputs["Color"]).outputs[0]
    big_mask = t.maprange(v3.outputs["Distance"], 0.32, 0.22, 0.0, 1.0)
    felds = t.math("MULTIPLY", big_mask, t.maprange(g3, 0.86, 0.87, 0.0, 1.0))
    bio = t.math("MULTIPLY", big_mask, t.maprange(g3, 0.10, 0.09, 0.0, 1.0))
    col = t.mix(felds, col, (0.24, 0.205, 0.195, 1))
    col = t.mix(bio, col, (0.01, 0.01, 0.012, 1))
    # dirt and foot-worn scuffs
    dirt = t.n("ShaderNodeTexNoise", Vector=V, Scale=1.3, Detail=4.0, Roughness=0.6)
    dirtf = t.maprange(dirt.outputs["Fac"], 0.45, 0.72, 1.0, 0.72)
    col = t.mix(1.0, col, t.n("ShaderNodeCombineColor", Red=dirtf, Green=dirtf, Blue=dirtf).outputs[0], "MULTIPLY")
    # per slab tone variation
    tone = t.maprange(slab_rand, 0.0, 1.0, 0.86, 1.10)
    col = t.mix(1.0, col, t.n("ShaderNodeCombineColor", Red=tone, Green=tone, Blue=tone).outputs[0], "MULTIPLY")
    # grime in joints + AO near objects
    ao = t.n("ShaderNodeAmbientOcclusion", Distance=0.25)
    aof = t.maprange(ao.outputs["AO"], 0.2, 1.0, 0.55, 1.0)
    col = t.mix(1.0, col, t.n("ShaderNodeCombineColor", Red=aof, Green=aof, Blue=aof).outputs[0], "MULTIPLY")
    col = t.mix(mortar, col, (0.07, 0.068, 0.065, 1))
    # roughness: honed 0.52, polished walking path, darker slightly wet-looking wax spots
    sep = t.n("ShaderNodeSeparateXYZ", Vector=V)
    path = t.maprange(t.math("ABSOLUTE", sep.outputs["X"]), 0.3, 1.6, 0.0, 1.0)
    rn = t.n("ShaderNodeTexNoise", Vector=V, Scale=9.0, Detail=5.0)
    rough = t.math("MULTIPLY_ADD", path, 0.16, 0.22)
    rough = t.math("MULTIPLY_ADD", rn.outputs["Fac"], 0.16, rough)
    rough = t.mix(mortar, rough, 0.85, kind="FLOAT")
    # bump: slab edges slightly eased, micro grain relief
    h = t.math("MULTIPLY_ADD", v2.outputs["Distance"], 0.15, t.math("SUBTRACT", 1.0, mortar))
    bump = t.n("ShaderNodeBump", Height=h, Strength=0.25, Distance=0.0015)
    principled(t, out, **{"Base Color": col, "Roughness": rough, "Normal": bump.outputs["Normal"]})
    return m


def mat_lacquer(name="red_lacquer", color=(0.30, 0.016, 0.011), rough=0.3, wear=0.0):
    m, t, out = new_mat(name)
    tc = t.n("ShaderNodeTexCoord")
    n = t.n("ShaderNodeTexNoise", Vector=tc.outputs["Object"], Scale=6.0, Detail=8.0)
    c = t.mix(t.maprange(n.outputs["Fac"], 0.3, 0.7, 0.0, 1.0), (*[x * 0.75 for x in color], 1), (*color, 1))
    ao = t.n("ShaderNodeAmbientOcclusion", Distance=0.05)
    c = t.mix(t.maprange(ao.outputs["AO"], 0.2, 1.0, 1.0, 0.0), c, (0.02, 0.004, 0.003, 1))
    principled(t, out, **{"Base Color": c, "Roughness": t.maprange(n.outputs["Fac"], 0, 1, rough - 0.08, rough + 0.12),
                         "Coat Weight": 0.4, "Coat Roughness": 0.15})
    return m


def mat_gold(name="gold", base=(0.95, 0.62, 0.22), rough=0.28, antique=0.6):
    m, t, out = new_mat(name)
    tc = t.n("ShaderNodeTexCoord")
    n = t.n("ShaderNodeTexNoise", Vector=tc.outputs["Object"], Scale=40.0, Detail=10.0)
    ao = t.n("ShaderNodeAmbientOcclusion", Distance=0.03)
    dark = t.maprange(ao.outputs["AO"], 0.3, 1.0, antique, 0.0)
    c = t.mix(dark, (*base, 1), (0.10, 0.055, 0.02, 1))
    r = t.maprange(n.outputs["Fac"], 0.3, 0.7, rough - 0.08, rough + 0.12)
    r = t.mix(dark, r, 0.7, kind="FLOAT")
    principled(t, out, **{"Base Color": c, "Metallic": 1.0, "Roughness": r})
    return m


def mat_simple(name, color, rough=0.5, metal=0.0, **extra):
    m, t, out = new_mat(name)
    kw = {"Base Color": (*color, 1), "Roughness": rough, "Metallic": metal}
    kw.update(extra)
    principled(t, out, **kw)
    return m


def mat_darkwood(name="darkwood", gilt=0.0):
    """Old dark carved wood; with gilt>0 the raised parts carry worn gold leaf."""
    m, t, out = new_mat(name)
    tc = t.n("ShaderNodeTexCoord")
    V = tc.outputs["Object"]
    n = t.n("ShaderNodeTexNoise", Vector=V, Scale=18.0, Detail=8.0)
    wv = t.n("ShaderNodeTexWave", Vector=V, Scale=9.0, Distortion=8.0, Detail=5.0)
    wv.bands_direction = "Z"
    wood = t.mix(t.maprange(wv.outputs["Fac"], 0.2, 0.9, 0, 1), (0.018, 0.010, 0.007, 1), (0.05, 0.028, 0.018, 1))
    ao = t.n("ShaderNodeAmbientOcclusion", Distance=0.04)
    geo = t.n("ShaderNodeNewGeometry")
    if gilt > 0:
        g = t.maprange(geo.outputs["Pointiness"], 0.5, 0.56, 0.0, 1.0)
        g = t.math("MULTIPLY", g, t.maprange(n.outputs["Fac"], 0.35, 0.55, 0.0, gilt))
        g = t.math("MULTIPLY", g, t.maprange(ao.outputs["AO"], 0.5, 1.0, 0.0, 1.0))
        base = t.mix(g, wood, (0.75, 0.48, 0.16, 1))
        metal = g
        rough = t.mix(g, 0.55, 0.3, kind="FLOAT")
    else:
        base, metal, rough = wood, 0.0, 0.5
    principled(t, out, **{"Base Color": base, "Metallic": metal, "Roughness": rough})
    return m


def mat_carving(name="carving", gilt=0.85, scale=14.0):
    """Flat panels that read as dense openwork carving (bump + gilt on the relief)."""
    m, t, out = new_mat(name)
    tc = t.n("ShaderNodeTexCoord")
    V = tc.outputs["Object"]
    vor = t.n("ShaderNodeTexVoronoi", Vector=V, Scale=scale, Randomness=0.9)
    vor.feature = "DISTANCE_TO_EDGE"
    wv = t.n("ShaderNodeTexWave", Vector=V, Scale=scale * 0.6, Distortion=12.0, Detail=4.0)
    wv.wave_type = "RINGS"
    n = t.n("ShaderNodeTexNoise", Vector=V, Scale=scale * 3, Detail=6.0)
    relief = t.math("MULTIPLY", t.maprange(vor.outputs["Distance"], 0.0, 0.12, 0.0, 1.0),
                    t.maprange(wv.outputs["Fac"], 0.25, 0.75, 0.3, 1.0))
    relief = t.math("MULTIPLY_ADD", n.outputs["Fac"], 0.25, relief)
    deep = t.maprange(relief, 0.15, 0.45, 1.0, 0.0)
    gold = t.maprange(relief, 0.45, 0.8, 0.0, gilt)
    base = t.mix(gold, (0.03, 0.016, 0.01, 1), (0.72, 0.46, 0.15, 1))
    base = t.mix(deep, base, (0.004, 0.002, 0.002, 1))
    bump = t.n("ShaderNodeBump", Height=relief, Strength=0.9, Distance=0.01)
    principled(t, out, **{"Base Color": base, "Metallic": gold, "Roughness": t.mix(gold, 0.6, 0.32, kind="FLOAT"),
                         "Normal": bump.outputs["Normal"]})
    return m


def mat_bronze(name="bronze"):
    m, t, out = new_mat(name)
    tc = t.n("ShaderNodeTexCoord")
    n = t.n("ShaderNodeTexNoise", Vector=tc.outputs["Object"], Scale=30.0, Detail=10.0, Roughness=0.6)
    ao = t.n("ShaderNodeAmbientOcclusion", Distance=0.05)
    pat = t.maprange(n.outputs["Fac"], 0.45, 0.62, 0.0, 1.0)
    base = t.mix(pat, (0.30, 0.17, 0.07, 1), (0.08, 0.05, 0.03, 1))
    base = t.mix(t.maprange(ao.outputs["AO"], 0.3, 1.0, 0.8, 0.0), base, (0.01, 0.008, 0.006, 1))
    principled(t, out, **{"Base Color": base, "Metallic": t.maprange(pat, 0, 1, 1.0, 0.4),
                         "Roughness": t.maprange(pat, 0, 1, 0.32, 0.7)})
    return m


def mat_emission(name, color, strength, diffuse=None):
    m, t, out = new_mat(name)
    e = t.n("ShaderNodeEmission", Color=(*color, 1), Strength=strength)
    if diffuse is None:
        t.link(e.outputs[0], out.inputs["Surface"])
    else:
        d = t.n("ShaderNodeBsdfDiffuse", Color=(*diffuse, 1))
        add = t.n("ShaderNodeAddShader")
        t.link(e.outputs[0], add.inputs[0]); t.link(d.outputs[0], add.inputs[1])
        t.link(add.outputs[0], out.inputs["Surface"])
    return m


def mat_lantern(name="lantern", color=(0.9, 0.06, 0.02), strength=2.2, base=(0.32, 0.012, 0.008)):
    """Silk lantern: glowing through the fabric, brighter toward the equator."""
    m, t, out = new_mat(name)
    tc = t.n("ShaderNodeTexCoord")
    geo = t.n("ShaderNodeNewGeometry")
    sep = t.n("ShaderNodeSeparateXYZ", Vector=tc.outputs["Generated"])
    band = t.math("SUBTRACT", 1.0, t.math("ABSOLUTE", t.math("SUBTRACT", sep.outputs["Z"], 0.5)))
    band = t.maprange(band, 0.5, 1.0, 0.25, 1.0)
    # ribs
    grad = t.n("ShaderNodeTexGradient", Vector=tc.outputs["Object"])
    grad.gradient_type = "RADIAL"
    rib = t.n("ShaderNodeMath"); rib.operation = "SINE"
    t.link(t.math("MULTIPLY", grad.outputs["Fac"], 2 * math.pi * 24), rib.inputs[0])
    ribm = t.maprange(rib.outputs[0], 0.85, 1.0, 1.0, 0.35)
    s = t.math("MULTIPLY", band, ribm)
    e = t.n("ShaderNodeEmission", Color=(*color, 1), Strength=t.math("MULTIPLY", s, strength))
    d = t.n("ShaderNodeBsdfPrincipled", **{"Base Color": (*base, 1), "Roughness": 0.5, "Sheen Weight": 0.35,
                                          "Sheen Tint": (1.0, 0.3, 0.2, 1)})
    add = t.n("ShaderNodeAddShader")
    t.link(e.outputs[0], add.inputs[0]); t.link(d.outputs[0], add.inputs[1])
    t.link(add.outputs[0], out.inputs["Surface"])
    return m


def mat_cloth(name="skirt", color=(0.33, 0.01, 0.012), sheen=(1.0, 0.35, 0.25)):
    m, t, out = new_mat(name)
    tc = t.n("ShaderNodeTexCoord")
    n = t.n("ShaderNodeTexNoise", Vector=tc.outputs["Object"], Scale=80.0, Detail=3.0)
    w = t.n("ShaderNodeTexWave", Vector=tc.outputs["Object"], Scale=900.0, Distortion=0.0)
    bump = t.n("ShaderNodeBump", Height=w.outputs["Fac"], Strength=0.08)
    principled(t, out, **{"Base Color": (*color, 1), "Roughness": t.maprange(n.outputs["Fac"], 0, 1, 0.45, 0.6),
                         "Sheen Weight": 0.8, "Sheen Tint": (*sheen, 1), "Sheen Roughness": 0.35,
                         "Normal": bump.outputs["Normal"]})
    return m


def mat_embroidery(name="embroidery", color=(0.85, 0.55, 0.16)):
    """Gold thread: metallic, anisotropic-ish via fine wave bump."""
    m, t, out = new_mat(name)
    tc = t.n("ShaderNodeTexCoord")
    w = t.n("ShaderNodeTexWave", Vector=tc.outputs["Object"], Scale=500.0, Distortion=2.0)
    w.bands_direction = "DIAGONAL"
    bump = t.n("ShaderNodeBump", Height=w.outputs["Fac"], Strength=0.35)
    principled(t, out, **{"Base Color": (*color, 1), "Metallic": 0.85, "Roughness": 0.38,
                         "Normal": bump.outputs["Normal"]})
    return m


def mat_wax(name="wax", color=(0.45, 0.02, 0.015)):
    return mat_simple(name, color, 0.35, **{"Subsurface Weight": 0.6, "Subsurface Radius": (0.02, 0.005, 0.004),
                                            "Subsurface Scale": 0.02})


def mat_flame(name="flame"):
    m, t, out = new_mat(name)
    tc = t.n("ShaderNodeTexCoord")
    sep = t.n("ShaderNodeSeparateXYZ", Vector=tc.outputs["Generated"])
    col = t.ramp(sep.outputs["Z"], [(0.0, (0.35, 0.45, 1.0)), (0.18, (1.0, 0.55, 0.12)), (0.6, (1.0, 0.78, 0.35)),
                                    (1.0, (1.0, 0.45, 0.08))])
    e = t.n("ShaderNodeEmission", Color=col, Strength=60.0)
    t.link(e.outputs[0], out.inputs["Surface"])
    return m


# ------------------------------------------------------------------ geometry

def link(ob, coll=None):
    (coll or bpy.context.scene.collection).objects.link(ob)
    return ob


def mesh_obj(name, bm, mat=None, smooth=False, coll=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    if smooth:
        me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    if mat:
        me.materials.append(mat)
    return link(ob, coll)


def box(name, size, loc, mat=None, bevel=0.0, rot=(0, 0, 0), coll=None, segs=2):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    ob = mesh_obj(name, bm, mat, coll=coll)
    ob.location = loc; ob.rotation_euler = rot
    if bevel > 0:
        b = ob.modifiers.new("bevel", "BEVEL"); b.width = bevel; b.segments = segs
        b.limit_method = "ANGLE"
        ob.modifiers.new("wn", "WEIGHTED_NORMAL")
        ob.data.shade_smooth()
    return ob


def cylinder(name, r, h, loc, mat=None, segs=48, r2=None, rot=(0, 0, 0), coll=None, smooth=True, cap=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=h)
    ob = mesh_obj(name, bm, mat, smooth=smooth, coll=coll)
    ob.location = loc; ob.rotation_euler = rot
    return ob


def lathe(name, profile, loc, mat=None, segs=64, coll=None, smooth=True):
    """profile: list of (radius, z) from bottom to top; revolved around Z."""
    bm = bmesh.new()
    rings = []
    for (r, z) in profile:
        ring = []
        for i in range(segs):
            a = 2 * math.pi * i / segs
            ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), z)))
        rings.append(ring)
    for k in range(len(rings) - 1):
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]))
    # caps if the ends are not on the axis
    if profile[0][0] > 1e-5:
        bm.faces.new(list(reversed(rings[0])))
    if profile[-1][0] > 1e-5:
        bm.faces.new(rings[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = mesh_obj(name, bm, mat, smooth=smooth, coll=coll)
    ob.location = loc
    return ob


def sphere(name, r, loc, mat=None, scale=(1, 1, 1), segs=32, rings=16, coll=None):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    ob = mesh_obj(name, bm, mat, smooth=True, coll=coll)
    ob.location = loc; ob.scale = scale
    return ob


def text(name, body, fontname, size, loc, rot=(math.pi / 2, 0, 0), mat=None, extrude=0.0, align="CENTER",
         spacing=1.0, coll=None, bevel=0.0):
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = body
    cu.font = font(fontname)
    cu.size = size
    cu.align_x = align
    cu.align_y = "CENTER"
    cu.extrude = extrude
    cu.bevel_depth = bevel
    cu.space_line = spacing
    ob = bpy.data.objects.new(name, cu)
    ob.location = loc; ob.rotation_euler = rot
    if mat:
        cu.materials.append(mat)
    return link(ob, coll)


def vertical(s):
    return "\n".join(s)


def mat_skirt(name="skirt", color=(0.30, 0.008, 0.010), gold=(0.85, 0.55, 0.16), cell=0.13):
    """Red satin with gold 雲紋 (cloud-scroll) embroidery arranged on a staggered grid.
    Works in the skirt's local XY (grid plane before the object rotation)."""
    m, t, out = new_mat(name)
    tc = t.n("ShaderNodeTexCoord")
    sep = t.n("ShaderNodeSeparateXYZ", Vector=tc.outputs["Object"])
    gx = t.math("DIVIDE", sep.outputs["X"], cell)
    col_i = t.math("FLOOR", gx)
    stagger = t.math("MULTIPLY", t.math("MODULO", t.math("ABSOLUTE", col_i), 2.0), 0.5)
    gy = t.math("ADD", t.math("DIVIDE", sep.outputs["Y"], cell), stagger)
    cx = t.math("SUBTRACT", t.math("FRACT", gx), 0.5)
    cy = t.math("SUBTRACT", t.math("FRACT", gy), 0.5)
    r = t.math("SQRT", t.math("ADD", t.math("MULTIPLY", cx, cx), t.math("MULTIPLY", cy, cy)))
    ang = t.math("ARCTAN2", cy, cx)
    phase = t.math("MULTIPLY_ADD", r, 30.0, ang)
    spiral = t.maprange(t.math("SINE", phase), 0.80, 0.95, 0.0, 1.0)
    inside = t.maprange(r, 0.30, 0.26, 0.0, 1.0)
    core = t.maprange(r, 0.045, 0.03, 0.0, 1.0)
    motif = t.math("MAXIMUM", t.math("MULTIPLY", spiral, inside), core)
    # sparse: every motif, but fade a little with noise so it reads hand-made
    n = t.n("ShaderNodeTexNoise", Vector=tc.outputs["Object"], Scale=60.0, Detail=4.0)
    motif = t.math("MULTIPLY", motif, t.maprange(n.outputs["Fac"], 0.2, 0.5, 0.6, 1.0))
    base = t.mix(motif, (*color, 1), (*gold, 1))
    thread = t.n("ShaderNodeTexWave", Vector=tc.outputs["Object"], Scale=700.0, Distortion=1.0)
    thread.bands_direction = "DIAGONAL"
    h = t.math("MULTIPLY_ADD", thread.outputs["Fac"], 0.3, motif)
    bump = t.n("ShaderNodeBump", Height=h, Strength=0.25, Distance=0.002)
    principled(t, out, **{"Base Color": base, "Metallic": t.math("MULTIPLY", motif, 0.85),
                         "Roughness": t.mix(motif, 0.5, 0.35, kind="FLOAT"),
                         "Sheen Weight": t.math("SUBTRACT", 0.8, motif), "Sheen Tint": (1.0, 0.35, 0.25, 1),
                         "Normal": bump.outputs["Normal"]})
    return m


def mat_lattice(name="lattice", gilt=0.8, cell=0.11, plane="XZ", wood=(0.028, 0.012, 0.008), petals=8):
    """Regular carved lattice (窗花/木雕): a grid of gilt rosettes framed by raised ribs,
    dark recesses between. Reads as the black-and-gold carving of Taiwanese shrines."""
    m, t, out = new_mat(name)
    tc = t.n("ShaderNodeTexCoord")
    sep = t.n("ShaderNodeSeparateXYZ", Vector=tc.outputs["Object"])
    a_ax = sep.outputs["X"] if plane[0] == "X" else sep.outputs["Y"]
    b_ax = sep.outputs["Z"]
    gu = t.math("DIVIDE", a_ax, cell); gv = t.math("DIVIDE", b_ax, cell)
    cu = t.math("SUBTRACT", t.math("FRACT", gu), 0.5)
    cv = t.math("SUBTRACT", t.math("FRACT", gv), 0.5)
    r = t.math("SQRT", t.math("ADD", t.math("MULTIPLY", cu, cu), t.math("MULTIPLY", cv, cv)))
    ang = t.math("ARCTAN2", cv, cu)
    petal = t.math("COSINE", t.math("MULTIPLY", ang, float(petals)))
    edge_r = t.math("MULTIPLY_ADD", petal, 0.07, 0.27)
    flower = t.maprange(t.math("SUBTRACT", r, edge_r), 0.01, -0.02, 0.0, 1.0)
    hole = t.maprange(r, 0.07, 0.05, 0.0, 1.0)
    ring = t.maprange(t.math("ABSOLUTE", t.math("SUBTRACT", r, 0.12)), 0.025, 0.012, 0.0, 1.0)
    rib = t.math("MAXIMUM", t.maprange(t.math("ABSOLUTE", cu), 0.44, 0.47, 0.0, 1.0),
                 t.maprange(t.math("ABSOLUTE", cv), 0.44, 0.47, 0.0, 1.0))
    # diagonal struts from the rosette to the corners
    d1 = t.math("ABSOLUTE", t.math("SUBTRACT", t.math("ABSOLUTE", cu), t.math("ABSOLUTE", cv)))
    strut = t.math("MULTIPLY", t.maprange(d1, 0.035, 0.015, 0.0, 1.0), t.maprange(r, 0.3, 0.34, 0.0, 1.0))
    relief = t.math("MAXIMUM", t.math("MAXIMUM", flower, rib), strut)
    relief = t.math("SUBTRACT", relief, t.math("MULTIPLY", hole, 0.6))
    relief = t.math("MAXIMUM", relief, ring)
    n = t.n("ShaderNodeTexNoise", Vector=tc.outputs["Object"], Scale=60.0, Detail=6.0)
    wear = t.maprange(n.outputs["Fac"], 0.3, 0.7, 0.55, 1.0)
    g = t.math("MULTIPLY", t.maprange(relief, 0.4, 0.8, 0.0, gilt), wear)
    base = t.mix(g, (*wood, 1), (0.78, 0.52, 0.18, 1))
    deep = t.maprange(relief, 0.3, 0.0, 0.0, 1.0)
    base = t.mix(deep, base, (0.003, 0.0015, 0.001, 1))
    bump = t.n("ShaderNodeBump", Height=relief, Strength=0.8, Distance=0.006)
    principled(t, out, **{"Base Color": base, "Metallic": g, "Roughness": t.mix(g, 0.55, 0.3, kind="FLOAT"),
                         "Normal": bump.outputs["Normal"]})
    return m


def mat_robe(name="robe", hem=0.05, belt=(0.3, 0.34)):
    """Gilded statue robe: fine brocade, red hem and belt painted on (object-space Z)."""
    m, t, out = new_mat(name)
    tc = t.n("ShaderNodeTexCoord")
    sep = t.n("ShaderNodeSeparateXYZ", Vector=tc.outputs["Object"])
    z = sep.outputs["Z"]
    vor = t.n("ShaderNodeTexVoronoi", Vector=tc.outputs["Object"], Scale=70.0, Randomness=0.2)
    vor.feature = "DISTANCE_TO_EDGE"
    brocade = t.maprange(vor.outputs["Distance"], 0.02, 0.06, 0.0, 1.0)
    gold = t.mix(brocade, (0.55, 0.33, 0.09, 1), (0.95, 0.68, 0.28, 1))
    hemm = t.maprange(z, hem + 0.005, hem - 0.005, 0.0, 1.0)
    beltm = t.math("MULTIPLY", t.maprange(z, belt[0] - 0.005, belt[0] + 0.005, 0.0, 1.0), t.maprange(z, belt[1] + 0.005, belt[1] - 0.005, 0.0, 1.0))
    red = t.math("MAXIMUM", hemm, beltm)
    col = t.mix(red, gold, (0.36, 0.02, 0.015, 1))
    metal = t.math("MULTIPLY", t.math("SUBTRACT", 1.0, red), 0.9)
    bump = t.n("ShaderNodeBump", Height=brocade, Strength=0.3, Distance=0.002)
    principled(t, out, **{"Base Color": col, "Metallic": metal, "Roughness": 0.32, "Normal": bump.outputs["Normal"]})
    return m
