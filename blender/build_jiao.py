"""Build the 筊 model in Blender: geometry, lacquer material, baked textures,
GLB export, convex-hull collider JSON and preview renders.

Run:  Blender -b -P build_jiao.py -- [--preview-only] [--no-bake]
"""
import bpy, bmesh, sys, os, math, json
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import importlib, jiao_geom
importlib.reload(jiao_geom)

ROOT = os.path.dirname(HERE)
ASSETS = os.path.join(ROOT, "public", "assets")
RENDERS = os.path.join(ROOT, "renders")
BAKED = os.path.join(HERE, "baked")
for d in (ASSETS, RENDERS, BAKED):
    os.makedirs(d, exist_ok=True)
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
TEX = 2048


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    sc.cycles.device = "GPU"
    sc.view_settings.view_transform = "Khronos PBR Neutral"
    return sc


def sock(node, ident, out=False):
    coll = node.outputs if out else node.inputs
    for s in coll:
        if s.identifier == ident:
            return s
    for s in coll:
        if s.name == ident and s.enabled:
            return s
    raise KeyError(f"{node.bl_idname}: {ident} in {[x.identifier for x in coll]}")


# ---------------------------------------------------------------- geometry

def build_mesh(name="Jiao"):
    v, f, rim, meta = jiao_geom.surface()
    vol, c = jiao_geom.volume_centroid(v, f)
    v = v - c  # origin at the centre of mass (uniform density)
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(p) for p in v], [], f)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    bm = bmesh.new(); bm.from_mesh(me)
    bm.edges.ensure_lookup_table()
    for e in bm.edges:
        key = tuple(sorted((e.verts[0].index, e.verts[1].index)))
        if key in rim:
            e.seam = True
            e.smooth = False
    for fc in bm.faces:
        fc.smooth = True
    bm.to_mesh(me); bm.free()
    return ob, v, meta, vol, c


def uv_unwrap(ob):
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.scene.objects:
        o.select_set(o == ob)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.unwrap(method="CONFORMAL", margin=0.02)
    bpy.ops.uv.pack_islands(margin=0.012, rotate=True)
    bpy.ops.object.mode_set(mode="OBJECT")


# ---------------------------------------------------------------- material

class NT:
    def __init__(self, mat):
        self.nt = mat.node_tree
        self.nt.nodes.clear()
        self.x = 0

    def n(self, kind, loc=(0, 0), **inputs):
        node = self.nt.nodes.new(kind)
        node.location = loc
        for k, val in inputs.items():
            if hasattr(val, "bl_idname") or isinstance(val, bpy.types.NodeSocket):
                self.nt.links.new(val, sock(node, k))
            else:
                sock(node, k).default_value = val
        return node

    def link(self, a, b):
        self.nt.links.new(a, b)


def ramp(t, node, stops):
    cr = node.color_ramp
    while len(cr.elements) < len(stops):
        cr.elements.new(0.5)
    for el, (pos, col) in zip(cr.elements, stops):
        el.position = pos
        el.color = col if len(col) == 4 else (*col, 1)


def lacquer_material(name, seed=0.0, H=0.0228, cz=0.009):
    """Red temple lacquer over hardwood, worn at the rim and the high points of
    the rounded back (the part that hits the floor), grime in the pores."""
    mat = bpy.data.materials.new(name)
    t = NT(mat)
    out = t.n("ShaderNodeOutputMaterial", (1800, 0))
    bsdf = t.n("ShaderNodeBsdfPrincipled", (1500, 0))
    t.link(bsdf.outputs["BSDF"], out.inputs["Surface"])

    tc = t.n("ShaderNodeTexCoord", (-1800, 0))
    mp = t.n("ShaderNodeMapping", (-1600, 0), Vector=tc.outputs["Object"])
    mp.inputs["Location"].default_value = (seed * 0.37, seed * 0.21, seed * 0.13)
    V = mp.outputs["Vector"]
    sep = t.n("ShaderNodeSeparateXYZ", (-1600, -300), Vector=tc.outputs["Object"])
    nsep = t.n("ShaderNodeSeparateXYZ", (-1600, -500), Vector=tc.outputs["Normal"])

    # ---- masks
    # flat face (object normal points to -Z)
    flat = t.n("ShaderNodeMapRange", (-1300, -500), Value=nsep.outputs["Z"])
    flat.inputs["From Min"].default_value = -0.6; flat.inputs["From Max"].default_value = -0.9
    # height on the back, 0 at the flat face, 1 at the ridge
    hgt = t.n("ShaderNodeMapRange", (-1300, -300), Value=sep.outputs["Z"])
    hgt.inputs["From Min"].default_value = -cz + H * 0.55
    hgt.inputs["From Max"].default_value = -cz + H * 1.0
    # edge mask from the bevel trick: 1 - dot(bevelN, N)
    geo = t.n("ShaderNodeNewGeometry", (-1600, -800))
    bev = t.n("ShaderNodeBevel", (-1400, -800))
    bev.samples = 16
    bev.inputs["Radius"].default_value = 0.0035
    dot = t.n("ShaderNodeVectorMath", (-1200, -800))
    dot.operation = "DOT_PRODUCT"
    t.link(bev.outputs["Normal"], dot.inputs[0]); t.link(geo.outputs["Normal"], dot.inputs[1])
    edge = t.n("ShaderNodeMapRange", (-1000, -800), Value=dot.outputs["Value"])
    edge.inputs["From Min"].default_value = 0.985; edge.inputs["From Max"].default_value = 0.80

    # breakup noises
    n1 = t.n("ShaderNodeTexNoise", (-1300, 200), Vector=V, Scale=90.0, Detail=10.0, Roughness=0.62)
    n2 = t.n("ShaderNodeTexNoise", (-1300, 450), Vector=V, Scale=22.0, Detail=4.0, Roughness=0.5)
    # scratches: noise stretched along the block
    sv = t.n("ShaderNodeMapping", (-1300, 700), Vector=V)
    sv.inputs["Scale"].default_value = (18.0, 260.0, 260.0)
    scr = t.n("ShaderNodeTexNoise", (-1100, 700), Vector=sv.outputs["Vector"], Scale=8.0, Detail=2.0)
    scr_m = t.n("ShaderNodeMapRange", (-900, 700), Value=scr.outputs["Fac"])
    scr_m.inputs["From Min"].default_value = 0.66; scr_m.inputs["From Max"].default_value = 0.72

    # wear = drivers (ridge of the back, rim, scratches) + breakup noise
    def math_node(op, a, b=None, c=None, loc=(0, 0)):
        m = t.n("ShaderNodeMath", loc); m.operation = op
        for i, v in enumerate((a, b, c)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                m.inputs[i].default_value = v
            else:
                t.link(v, m.inputs[i])
        return m.outputs["Value"]
    drv = math_node("MULTIPLY", hgt.outputs["Result"], 0.17, loc=(-1000, -250))
    drv = math_node("MULTIPLY_ADD", edge.outputs["Result"], 0.75, drv, loc=(-850, -250))
    drv = math_node("MULTIPLY_ADD", scr_m.outputs["Result"], 0.22, drv, loc=(-700, -250))
    nz = math_node("MULTIPLY_ADD", n1.outputs["Fac"], 0.9, -0.45, loc=(-1000, -100))
    nz = math_node("MULTIPLY_ADD", n2.outputs["Fac"], 0.7, nz, loc=(-850, -100))
    nz = math_node("ADD", nz, -0.35, loc=(-700, -100))
    wsum = math_node("ADD", drv, nz, loc=(-550, -200))
    wear = t.n("ShaderNodeMapRange", (-400, -250), Value=wsum)
    wear.inputs["From Min"].default_value = 0.10; wear.inputs["From Max"].default_value = 0.16
    thin = t.n("ShaderNodeMapRange", (-400, -450), Value=wsum)
    thin.inputs["From Min"].default_value = -0.05; thin.inputs["From Max"].default_value = 0.12

    # ---- colours
    # hardwood (longan / camphor) grain running along the block
    wave = t.n("ShaderNodeTexWave", (-1100, 1000), Vector=V, Scale=420.0, Distortion=14.0, Detail=8.0)
    wave.inputs["Detail Scale"].default_value = 1.6
    wave.wave_type = "BANDS"; wave.bands_direction = "Y"
    wood = t.n("ShaderNodeValToRGB", (-850, 1000), Fac=wave.outputs["Fac"])
    ramp(t, wood, [(0.0, (0.075, 0.045, 0.028)), (0.5, (0.13, 0.082, 0.05)), (1.0, (0.20, 0.13, 0.08))])
    # old worn wood gets grey / dark from hands and floors
    oldwood = t.n("ShaderNodeMix", (-600, 1000))
    oldwood.data_type = "RGBA"; oldwood.blend_type = "MULTIPLY"
    sock(oldwood, "Factor_Float").default_value = 0.55
    t.link(wood.outputs["Color"], sock(oldwood, "A_Color"))
    sock(oldwood, "B_Color").default_value = (0.55, 0.47, 0.42, 1)

    # lacquer red: vermilion, mottled darker where old; flat face slightly brighter
    lr = t.n("ShaderNodeValToRGB", (-850, 250), Fac=n2.outputs["Fac"])
    ramp(t, lr, [(0.30, (0.17, 0.0075, 0.0055)), (0.72, (0.29, 0.013, 0.008))])
    lr_flat = t.n("ShaderNodeValToRGB", (-850, 450), Fac=n2.outputs["Fac"])
    ramp(t, lr_flat, [(0.30, (0.30, 0.15, 0.022)), (0.72, (0.46, 0.25, 0.04))])
    lac = t.n("ShaderNodeMix", (-600, 350)); lac.data_type = "RGBA"
    t.link(flat.outputs["Result"], sock(lac, "Factor_Float"))
    t.link(lr.outputs["Color"], sock(lac, "A_Color")); t.link(lr_flat.outputs["Color"], sock(lac, "B_Color"))

    # thin, rubbed lacquer turns a darker brownish red before the wood shows
    thinc = t.n("ShaderNodeMix", (-350, 350)); thinc.data_type = "RGBA"; thinc.blend_type = "MULTIPLY"
    t.link(thin.outputs["Result"], sock(thinc, "Factor_Float"))
    t.link(sock(lac, "Result_Color", out=True), sock(thinc, "A_Color"))
    sock(thinc, "B_Color").default_value = (0.55, 0.42, 0.40, 1)
    base = t.n("ShaderNodeMix", (-100, 300)); base.data_type = "RGBA"
    t.link(wear.outputs["Result"], sock(base, "Factor_Float"))
    t.link(sock(thinc, "Result_Color", out=True), sock(base, "A_Color"))
    t.link(sock(oldwood, "Result_Color", out=True), sock(base, "B_Color"))

    # grime from AO + pores
    ao = t.n("ShaderNodeAmbientOcclusion", (-400, 0))
    ao.samples = 16
    ao.only_local = True
    ao.inputs["Distance"].default_value = 0.012
    gm = t.n("ShaderNodeMapRange", (-200, 0), Value=ao.outputs["AO"])
    gm.inputs["From Min"].default_value = 0.3; gm.inputs["To Min"].default_value = 0.6
    dirt = t.n("ShaderNodeMix", (150, 300)); dirt.data_type = "RGBA"; dirt.blend_type = "MULTIPLY"
    sock(dirt, "Factor_Float").default_value = 1.0
    t.link(sock(base, "Result_Color", out=True), sock(dirt, "A_Color"))
    t.link(gm.outputs["Result"], sock(dirt, "B_Color"))
    t.link(sock(dirt, "Result_Color", out=True), bsdf.inputs["Base Color"])

    # ---- roughness: satin old lacquer, dry worn wood
    rl = t.n("ShaderNodeMapRange", (-100, -300), Value=n1.outputs["Fac"])
    rl.inputs["To Min"].default_value = 0.26; rl.inputs["To Max"].default_value = 0.42
    rmix = t.n("ShaderNodeMix", (200, -300)); rmix.data_type = "FLOAT"
    t.link(wear.outputs["Result"], sock(rmix, "Factor_Float"))
    t.link(rl.outputs["Result"], sock(rmix, "A_Float"))
    sock(rmix, "B_Float").default_value = 0.62
    t.link(sock(rmix, "Result_Float", out=True), bsdf.inputs["Roughness"])

    # ---- normal: bevel-rounded rim + grain in worn wood + tiny dents in lacquer
    dents = t.n("ShaderNodeTexVoronoi", (300, -700), Vector=V, Scale=160.0)
    hsum = t.n("ShaderNodeMath", (550, -700)); hsum.operation = "MULTIPLY_ADD"
    t.link(wave.outputs["Fac"], hsum.inputs[0])
    wq = math_node("MULTIPLY", wear.outputs["Result"], 0.25, loc=(400, -800))
    t.link(wq, hsum.inputs[1])
    t.link(dents.outputs["Distance"], hsum.inputs[2])
    bump = t.n("ShaderNodeBump", (1100, -600), Height=hsum.outputs["Value"], Normal=bev.outputs["Normal"])
    bump.inputs["Strength"].default_value = 0.05
    bump.inputs["Distance"].default_value = 0.0002
    t.link(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


# ---------------------------------------------------------------- baking

def bake_maps(ob, mat, tag, samples=64):
    sc = bpy.context.scene
    sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = False
    sc.render.bake.margin = 16
    sc.render.bake.use_selected_to_active = False
    nodes = mat.node_tree.nodes
    results = {}
    for kind, btype, cs in (("color", "DIFFUSE", "sRGB"), ("rough", "ROUGHNESS", "Non-Color"), ("normal", "NORMAL", "Non-Color")):
        img = bpy.data.images.new(f"{tag}_{kind}", TEX, TEX, alpha=False)
        img.colorspace_settings.name = cs
        node = nodes.new("ShaderNodeTexImage"); node.image = img
        node.location = (1500, 600)
        for n in nodes:
            n.select = False
        node.select = True; nodes.active = node
        for o in sc.objects:
            o.select_set(o == ob)
        bpy.context.view_layer.objects.active = ob
        kw = dict(type=btype, margin=16)
        if btype == "DIFFUSE":
            kw["pass_filter"] = {"COLOR"}
        if btype == "NORMAL":
            kw["normal_space"] = "TANGENT"
        bpy.ops.object.bake(**kw)
        path = os.path.join(BAKED, f"{tag}_{kind}.png")
        img.filepath_raw = path
        img.file_format = "PNG"
        img.save()
        nodes.remove(node)
        results[kind] = path
        print("baked", tag, kind)
    return results


def export_material(name, maps):
    mat = bpy.data.materials.new(name)
    t = NT(mat)
    out = t.n("ShaderNodeOutputMaterial", (600, 0))
    b = t.n("ShaderNodeBsdfPrincipled", (300, 0))
    t.link(b.outputs["BSDF"], out.inputs["Surface"])
    col = t.n("ShaderNodeTexImage", (-300, 200)); col.image = bpy.data.images.load(maps["color"])
    rgh = t.n("ShaderNodeTexImage", (-300, -100)); rgh.image = bpy.data.images.load(maps["rough"])
    rgh.image.colorspace_settings.name = "Non-Color"
    nrm = t.n("ShaderNodeTexImage", (-300, -400)); nrm.image = bpy.data.images.load(maps["normal"])
    nrm.image.colorspace_settings.name = "Non-Color"
    nm = t.n("ShaderNodeNormalMap", (0, -400))
    t.link(col.outputs["Color"], b.inputs["Base Color"])
    t.link(rgh.outputs["Color"], b.inputs["Roughness"])
    t.link(nrm.outputs["Color"], nm.inputs["Color"])
    t.link(nm.outputs["Normal"], b.inputs["Normal"])
    b.inputs["Coat Weight"].default_value = 0.25
    b.inputs["Coat Roughness"].default_value = 0.18
    return mat


# ---------------------------------------------------------------- preview

def studio(sc):
    world = bpy.data.worlds.new("w"); sc.world = world
    wn = world.node_tree.nodes.get("Background")
    wn.inputs["Color"].default_value = (0.02, 0.018, 0.016, 1)
    cam_d = bpy.data.cameras.new("cam"); cam_d.lens = 70
    cam = bpy.data.objects.new("cam", cam_d); sc.collection.objects.link(cam)
    sc.camera = cam
    for i, (loc, e, size) in enumerate([((0.35, -0.35, 0.55), 9, 0.35), ((-0.5, 0.1, 0.3), 2.5, 0.5), ((0.0, 0.6, 0.35), 3.5, 0.4)]):
        ld = bpy.data.lights.new(f"l{i}", "AREA"); ld.energy = e; ld.size = size
        ld.color = (1.0, 0.92, 0.82)
        lo = bpy.data.objects.new(f"l{i}", ld); lo.location = loc
        sc.collection.objects.link(lo)
        lo.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    pl = bpy.data.meshes.new("floor")
    bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=2); bm.to_mesh(pl)
    flo = bpy.data.objects.new("floor", pl); sc.collection.objects.link(flo)
    fm = bpy.data.materials.new("floor")
    fb = fm.node_tree.nodes.get("Principled BSDF")
    fb.inputs["Base Color"].default_value = (0.09, 0.09, 0.095, 1); fb.inputs["Roughness"].default_value = 0.55
    pl.materials.append(fm)
    sc.render.resolution_x = 1600; sc.render.resolution_y = 1000
    sc.cycles.samples = 256
    return cam


def look(cam, loc, target):
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()


def main():
    sc = reset()
    ob, v, meta, vol, c = build_mesh("Jiao")
    print(f"volume {vol*1e6:.2f} cm3, centroid {c}")
    uv_unwrap(ob)
    H = jiao_geom.P["H"]; cz = c[2]

    # colliders (convex pieces), in glTF / three.js frame: (x, z, -y)
    import export_colliders
    export_colliders.export()

    obB = ob.copy(); obB.data = ob.data.copy(); obB.name = "JiaoB"
    sc.collection.objects.link(obB)
    mats = {}
    for o, tag, seed in ((ob, "jiaoA", 0.0), (obB, "jiaoB", 7.3)):
        m = lacquer_material(f"{tag}_proc", seed=seed, H=H, cz=cz)
        o.data.materials.clear(); o.data.materials.append(m)
        mats[tag] = m

    if "--no-bake" not in ARGS:
        # keep the twin well away while baking so AO / bevel rays never see it
        obB.location = (0.6, 0, 0)
        for o, tag in ((ob, "jiaoA"), (obB, "jiaoB")):
            maps = bake_maps(o, mats[tag], tag)
            em = export_material(tag, maps)
            o.data.materials.clear(); o.data.materials.append(em)
        obB.location = (0, 0, 0)
        for o in sc.objects:
            o.select_set(o in (ob, obB))
        bpy.ops.export_scene.gltf(filepath=os.path.join(ASSETS, "jiao.glb"), use_selection=True,
                                  export_format="GLB", export_image_format="WEBP", export_image_quality=90,
                                  export_yup=True, export_apply=True, export_texcoords=True, export_normals=True,
                                  export_tangents=False, export_materials="EXPORT")
        print("exported glb")

    # preview: one flat-down (back up), one flat-up, like a 聖筊
    cam = studio(sc)
    ob.location = (-0.05, 0.02, cz)
    ob.rotation_euler = (0, 0, math.radians(12))
    obB.location = (0.058, -0.035, H - cz)
    obB.rotation_euler = (math.pi, 0, math.radians(-150))
    look(cam, (0.02, -0.40, 0.30), (0.005, 0.0, 0.0))
    sc.render.filepath = os.path.join(RENDERS, "jiao_preview.png")
    bpy.ops.render.render(write_still=True)
    look(cam, (0.0, -0.08, 0.42), (0.0, 0.0, 0.0))
    sc.render.filepath = os.path.join(RENDERS, "jiao_preview_top.png")
    bpy.ops.render.render(write_still=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "jiao.blend"))


main()
