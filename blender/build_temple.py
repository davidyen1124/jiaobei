"""Temple main hall (正殿) around the spot where the 筊 are thrown.

Blender frame: X right, Y toward the altar, Z up. The viewer kneels at the
origin with eyes at EYE; the blocks land on the granite floor around
y = 1.1 .. 1.9 m in front of the offering table.

Run:  Blender -b -P build_temple.py -- <mode> [options]
  modes: preview  (perspective test renders)
         pano     (final equirectangular background plate)
         probe    (HDR environment at the landing zone for IBL)
         ref      (perspective reference with two blocks placed, for matching)
"""
import bpy, bmesh, sys, os, math, random, json
from mathutils import Vector, Euler, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import importlib, temple_lib as T
importlib.reload(T)

ROOT = os.path.dirname(HERE)
ASSETS = os.path.join(ROOT, "public", "assets")
RENDERS = os.path.join(ROOT, "renders")
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
MODE = ARGS[0] if ARGS else "preview"


def opt(name, default):
    for a in ARGS:
        if a.startswith(f"--{name}="):
            return type(default)(a.split("=", 1)[1])
    return default


EYE = Vector((0.0, 0.0, 1.12))
random.seed(11)

# layout (metres)
TABLE_FRONT = 2.45      # lower offering table front face (y)
TABLE_DEPTH = 0.86
TABLE_W = 2.4
TABLE_H = 0.92
ALTAR_Y0, ALTAR_Y1, ALTAR_H, ALTAR_W = 3.55, 4.35, 1.22, 3.1
SHRINE_Y0, SHRINE_Y1 = 4.5, 5.6
PILLAR_X, PILLAR_Y, PILLAR_R = 2.0, 3.05, 0.21
HALL_X, HALL_Y0, HALL_Y1, HALL_Z = 5.2, -3.8, 6.2, 6.4


def setup():
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
    sc.view_settings.exposure = opt("exposure", 0.0)
    sc.cycles.use_light_tree = True
    sc.cycles.max_bounces = 10
    sc.cycles.diffuse_bounces = 5
    sc.cycles.glossy_bounces = 5
    sc.cycles.transmission_bounces = 6
    sc.cycles.caustics_reflective = False
    sc.cycles.caustics_refractive = False
    sc.cycles.blur_glossy = 1.0
    sc.cycles.sample_clamp_indirect = 8.0
    sc.render.film_transparent = False
    world = bpy.data.worlds.new("world"); sc.world = world
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.010, 0.008, 0.007, 1)
    bg.inputs["Strength"].default_value = 1.0
    return sc


# ======================================================================= materials
M = {}


def materials():
    M["granite"] = T.mat_granite()
    M["red"] = T.mat_lacquer("red_lacquer", (0.30, 0.018, 0.012), 0.28)
    M["red_dark"] = T.mat_lacquer("red_dark", (0.14, 0.010, 0.008), 0.35)
    M["black"] = T.mat_lacquer("black_lacquer", (0.012, 0.010, 0.010), 0.25)
    M["gold"] = T.mat_gold("gold")
    M["gold_bright"] = T.mat_gold("gold_bright", (1.0, 0.70, 0.30), 0.22, 0.35)
    M["darkwood"] = T.mat_darkwood("darkwood")
    M["darkwood_gilt"] = T.mat_darkwood("darkwood_gilt", gilt=0.9)
    M["carving"] = T.mat_carving("carving", 0.5, 14.0)
    M["carving_fine"] = T.mat_carving("carving_fine", 0.6, 30.0)
    M["carving_dim"] = T.mat_carving("carving_dim", 0.25, 22.0)
    M["lattice"] = T.mat_lattice("lattice", 0.85, 0.11)
    M["lattice_side"] = T.mat_lattice("lattice_side", 0.75, 0.1, plane="YZ")
    M["lattice_fine"] = T.mat_lattice("lattice_fine", 0.9, 0.055, petals=6)
    M["lattice_red"] = T.mat_lattice("lattice_red", 0.9, 0.16, wood=(0.18, 0.008, 0.006), petals=6)
    M["robe"] = T.mat_robe()
    M["robe_plain"] = T.mat_robe("robe_plain", hem=-10.0, belt=(-10.0, -9.0))
    M["bronze"] = T.mat_bronze()
    M["skirt"] = T.mat_skirt("skirt")
    M["valance"] = T.mat_cloth("valance", (0.55, 0.30, 0.02), (1.0, 0.8, 0.4))
    M["embroidery"] = T.mat_embroidery()
    M["wax"] = T.mat_wax()
    M["flame"] = T.mat_flame()
    M["lantern"] = T.mat_lantern("lantern", (1.0, 0.075, 0.018), opt("lantern", 0.42))
    M["lantern_small"] = T.mat_lantern("lantern_small", (1.0, 0.1, 0.02), opt("lantern", 0.42) * 0.85)
    M["ink"] = T.mat_simple("ink", (0.01, 0.008, 0.008), 0.5)
    M["tassel"] = T.mat_simple("tassel", (0.45, 0.02, 0.015), 0.6, **{"Sheen Weight": 1.0})
    M["plaster"] = T.mat_simple("plaster", (0.17, 0.105, 0.075), 0.8)
    M["stone_light"] = T.mat_granite("stone_light", joints=False)
    M["ash"] = T.mat_simple("ash", (0.35, 0.33, 0.30), 0.95)
    M["incense"] = T.mat_simple("incense", (0.12, 0.06, 0.035), 0.8)
    M["incense_stick"] = T.mat_simple("incense_stick", (0.5, 0.03, 0.02), 0.6)
    M["ember"] = T.mat_emission("ember", (1.0, 0.25, 0.04), 40.0)
    M["orange"] = T.mat_simple("orange", (0.75, 0.22, 0.02), 0.45, **{"Subsurface Weight": 0.2, "Subsurface Radius": (0.01, 0.005, 0.002), "Subsurface Scale": 0.01})
    M["apple"] = T.mat_simple("apple", (0.40, 0.03, 0.02), 0.35)
    M["plate"] = T.mat_simple("plate", (0.55, 0.05, 0.03), 0.25)
    M["porcelain"] = T.mat_simple("porcelain", (0.8, 0.8, 0.78), 0.12)
    M["leaf"] = T.mat_simple("leaf", (0.03, 0.12, 0.03), 0.5)
    M["bamboo"] = T.mat_simple("bamboo", (0.45, 0.30, 0.12), 0.45)
    M["cushion"] = T.mat_cloth("cushion", (0.32, 0.012, 0.012))
    M["light_box"] = T.mat_emission("light_box", (1.0, 0.62, 0.25), opt("gmd", 3.5))
    M["mazu_face"] = T.mat_simple("mazu_face", (0.03, 0.022, 0.02), 0.35)
    M["door"] = T.mat_emission("door", (0.92, 0.95, 1.0), opt("door", 28.0))
    M["beam_paint"] = T.mat_lacquer("beam_paint", (0.05, 0.12, 0.10), 0.5)
    for name, col in (("fl_yellow", (0.85, 0.55, 0.02)), ("fl_pink", (0.8, 0.15, 0.25)), ("fl_white", (0.8, 0.78, 0.7)),
                      ("fl_purple", (0.3, 0.05, 0.45))):
        M[name] = T.mat_simple(name, col, 0.6, **{"Subsurface Weight": 0.3, "Subsurface Radius": (0.01, 0.01, 0.01), "Subsurface Scale": 0.01})


# ======================================================================= room
def build_room():
    # floor
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5)
    bmesh.ops.scale(bm, vec=(2 * HALL_X, HALL_Y1 - HALL_Y0, 1), verts=bm.verts)
    fl = T.mesh_obj("floor", bm, M["granite"])
    fl.location = (0.3, (HALL_Y0 + HALL_Y1) / 2, 0)   # x offset puts a slab centre at x=0
    # the granite shader works in object space; undo the offset so joints line up with world
    fl.location = (0, 0, 0)
    fl.data.transform(Matrix.Translation((0.0, (HALL_Y0 + HALL_Y1) / 2, 0)))
    fl.data.update()

    # walls
    T.box("wall_back", (2 * HALL_X, 0.3, HALL_Z), (0, HALL_Y1 + 0.15, HALL_Z / 2), M["darkwood"])
    for s in (-1, 1):
        T.box(f"wall_side{s}", (0.3, HALL_Y1 - HALL_Y0, HALL_Z), (s * (HALL_X + 0.15), (HALL_Y0 + HALL_Y1) / 2, HALL_Z / 2), M["plaster"])
        # dark wainscot
        T.box(f"wainscot{s}", (0.04, HALL_Y1 - HALL_Y0, 1.0), (s * (HALL_X - 0.02), (HALL_Y0 + HALL_Y1) / 2, 0.5), M["red_dark"])
    T.box("ceiling", (2 * HALL_X, HALL_Y1 - HALL_Y0, 0.3), (0, (HALL_Y0 + HALL_Y1) / 2, HALL_Z + 0.15), M["darkwood"])
    # beams across the hall
    for y in (-2.5, -0.5, 1.5, 3.5, 5.5):
        T.box(f"beam{y}", (2 * HALL_X, 0.32, 0.45), (0, y, HALL_Z - 0.3), M["beam_paint"], bevel=0.02)
        T.box(f"beamgold{y}", (2 * HALL_X, 0.33, 0.05), (0, y, HALL_Z - 0.5), M["gold"])
    # front wall with the main door (behind the viewer) -> daylight source
    dw, dh = 3.0, 3.4
    for s in (-1, 1):
        w = HALL_X - dw / 2
        T.box(f"front_wall{s}", (w, 0.3, HALL_Z), (s * (dw / 2 + w / 2), HALL_Y0 - 0.15, HALL_Z / 2), M["red_dark"])
    T.box("front_lintel", (dw, 0.3, HALL_Z - dh), (0, HALL_Y0 - 0.15, dh + (HALL_Z - dh) / 2), M["red_dark"])
    bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5)
    bmesh.ops.scale(bm, vec=(dw, dh, 1), verts=bm.verts)
    door = T.mesh_obj("door_light", bm, M["door"])
    door.location = (0, HALL_Y0 - 0.35, dh / 2); door.rotation_euler = (-math.pi / 2, 0, 0)
    # side windows (softer daylight from the left)
    for y in (0.2, 2.6):
        bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5)
        bmesh.ops.scale(bm, vec=(1.2, 1.4, 1), verts=bm.verts)
        wl = T.mesh_obj(f"window{y}", bm, T.mat_emission(f"win{y}", (0.95, 0.93, 0.88), opt("window", 3.0)))
        wl.location = (-HALL_X - 0.01, y, 3.2); wl.rotation_euler = (0, math.pi / 2, 0)
        # lattice in front of the window
        for k in range(-5, 6):
            T.box(f"lat{y}{k}", (0.04, 0.03, 1.4), (-HALL_X + 0.03, y + k * 0.11, 3.2), M["darkwood"])
        for k in range(-6, 7):
            T.box(f"latz{y}{k}", (0.04, 1.2, 0.025), (-HALL_X + 0.035, y, 3.2 + k * 0.11), M["darkwood"])


def build_pillars():
    for s in (-1, 1):
        x = s * PILLAR_X
        base = T.lathe(f"pbase{s}", [(0.33, 0), (0.34, 0.05), (0.31, 0.12), (0.33, 0.22), (0.27, 0.32), (0.23, 0.36), (0.0, 0.36)],
                       (x, PILLAR_Y, 0), M["stone_light"])
        shaft = T.cylinder(f"pillar{s}", PILLAR_R, HALL_Z - 0.36, (x, PILLAR_Y, 0.36 + (HALL_Z - 0.36) / 2), M["red"], segs=64)
        # couplet board facing the viewer
        bw, bh = 0.27, 2.75
        T.box(f"couplet{s}", (bw, 0.035, bh), (x, PILLAR_Y - PILLAR_R - 0.02, 1.0 + bh / 2), M["black"], bevel=0.006)
        T.box(f"cframe{s}", (bw + 0.03, 0.03, bh + 0.03), (x, PILLAR_Y - PILLAR_R - 0.005, 1.0 + bh / 2), M["gold"])
        # 上聯 on the right (as the viewer faces the altar), 下聯 on the left
        body = "聖德昭昭澤被四海" if s > 0 else "母儀赫赫恩流萬家"
        T.text(f"ctext{s}", T.vertical(body), "kai", 0.2, (x, PILLAR_Y - PILLAR_R - 0.045, 1.0 + bh / 2),
               mat=M["gold_bright"], extrude=0.004, spacing=1.35)
    # a second, nearer pair of pillars at the sides of the viewer
    for s in (-1, 1):
        x = s * 3.4
        T.lathe(f"pbase2{s}", [(0.36, 0), (0.37, 0.06), (0.33, 0.14), (0.35, 0.25), (0.29, 0.36), (0.0, 0.36)],
                (x, 0.4, 0), M["stone_light"])
        T.cylinder(f"pillar2{s}", 0.23, HALL_Z - 0.36, (x, 0.4, 0.36 + (HALL_Z - 0.36) / 2), M["red"], segs=64)


def build_tables():
    y0, d, w, h = TABLE_FRONT, TABLE_DEPTH, TABLE_W, TABLE_H
    yc = y0 + d / 2
    # lower offering table (供桌)
    T.box("table_top", (w, d, 0.06), (0, yc, h - 0.03), M["red"], bevel=0.008)
    T.box("table_apron", (w - 0.06, d - 0.06, 0.14), (0, yc, h - 0.13), M["lattice_fine"])
    for sx in (-1, 1):
        for sy in (-1, 1):
            T.box(f"tleg{sx}{sy}", (0.09, 0.09, h - 0.06), (sx * (w / 2 - 0.06), yc + sy * (d / 2 - 0.06), (h - 0.06) / 2), M["red"], bevel=0.01)
    # 桌裙: embroidered red silk hanging in front
    sk_w, sk_top, sk_bot = w - 0.08, h - 0.04, 0.035
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=120, y_segments=40, size=0.5)
    bmesh.ops.scale(bm, vec=(sk_w, sk_top - sk_bot, 1), verts=bm.verts)
    for v in bm.verts:  # soft vertical folds, stronger toward the hem
        t = 0.5 - v.co.y / (sk_top - sk_bot)
        v.co.z = 0.004 * math.sin(v.co.x * 17.0) * (0.3 + t) + 0.0015 * math.sin(v.co.x * 53.0 + 1.3)
    skirt = T.mesh_obj("skirt", bm, M["skirt"], smooth=True)
    skirt.location = (0, y0 - 0.035, (sk_top + sk_bot) / 2); skirt.rotation_euler = (math.pi / 2, 0, 0)
    # upper band with gold border and 4 characters
    band_h = 0.2
    T.box("skirt_band", (sk_w, 0.012, band_h), (0, y0 - 0.052, sk_top - band_h / 2), M["red"])
    for zz in (sk_top - 0.012, sk_top - band_h + 0.012, sk_bot + 0.03):
        T.box(f"skirt_border{zz:.2f}", (sk_w, 0.016, 0.022), (0, y0 - 0.058, zz), M["embroidery"])
    for sx in (-1, 1):
        T.box(f"skirt_side{sx}", (0.022, 0.016, sk_top - sk_bot), (sx * (sk_w / 2 - 0.011), y0 - 0.058, (sk_top + sk_bot) / 2), M["embroidery"])
    T.text("skirt_text", "安平境合", "kai", 0.135, (0, y0 - 0.062, sk_top - band_h / 2 - 0.005), mat=M["embroidery"], extrude=0.002)
    # central medallion: embroidered ring with 壽, flanked by cloud swirls
    ring = bpy.data.meshes.new("medal")
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=False, segments=96, radius=0.2)
    bm.to_mesh(ring); bm.free()
    mo = bpy.data.objects.new("medal", ring); T.link(mo)
    mo.location = (0, y0 - 0.062, 0.38); mo.rotation_euler = (math.pi / 2, 0, 0)
    sk = mo.modifiers.new("skin", "SKIN")
    for vv in ring.skin_vertices[0].data:
        vv.radius = (0.012, 0.012)
    mo.modifiers.new("sub", "SUBSURF").levels = 1
    ring.materials.append(M["embroidery"])
    T.text("skirt_shou", "壽", "kai", 0.26, (0, y0 - 0.064, 0.38), mat=M["embroidery"], extrude=0.002)
    # red satin disc behind the medallion so the pattern doesn't run through it
    disc = T.cylinder("medal_disc", 0.19, 0.004, (0, y0 - 0.058, 0.38), M["red"], rot=(math.pi / 2, 0, 0), segs=64)
    # fringe at the hem
    for i in range(160):
        x = -sk_w / 2 + (i + 0.5) * sk_w / 160
        T.cylinder(f"fringe{i}", 0.0035, 0.05, (x, y0 - 0.05, 0.03), M["embroidery"], segs=6)

    # upper altar table (神案) with carved gilt front
    ay = (ALTAR_Y0 + ALTAR_Y1) / 2
    T.box("altar_top", (ALTAR_W, ALTAR_Y1 - ALTAR_Y0, 0.08), (0, ay, ALTAR_H - 0.04), M["red"], bevel=0.01)
    T.box("altar_body", (ALTAR_W - 0.1, ALTAR_Y1 - ALTAR_Y0 - 0.1, ALTAR_H - 0.08), (0, ay, (ALTAR_H - 0.08) / 2), M["red_dark"])
    T.box("altar_panel", (ALTAR_W - 0.3, 0.03, ALTAR_H - 0.35), (0, ALTAR_Y0 + 0.035, (ALTAR_H - 0.08) / 2 + 0.05), M["lattice"])
    T.box("altar_frame", (ALTAR_W - 0.22, 0.02, ALTAR_H - 0.27), (0, ALTAR_Y0 + 0.045, (ALTAR_H - 0.08) / 2 + 0.05), M["gold"])


def build_shrine():
    y0, y1 = SHRINE_Y0, SHRINE_Y1
    yc = (y0 + y1) / 2
    zb = ALTAR_H
    # platform
    T.box("shrine_base", (3.2, y1 - y0, 0.3), (0, yc, zb + 0.15), M["lattice_fine"])
    T.box("shrine_base_top", (3.24, y1 - y0 + 0.04, 0.05), (0, yc, zb + 0.32), M["gold"])
    # back panel red with gold
    T.box("shrine_back", (3.0, 0.08, 2.9), (0, y1 - 0.05, zb + 0.3 + 1.45), M["red_dark"])
    T.box("shrine_back_carve", (2.3, 0.03, 1.8), (0, y1 - 0.1, zb + 0.35 + 1.15), M["lattice_red"])
    # posts
    for s in (-1, 1):
        for yy in (y0 + 0.08, y1 - 0.15):
            T.box(f"spost{s}{yy:.1f}", (0.16, 0.16, 2.9), (s * 1.5, yy, zb + 0.3 + 1.45), M["darkwood_gilt"], bevel=0.02)
        # carved side screens
        T.box(f"sside{s}", (0.04, y1 - y0 - 0.2, 2.4), (s * 1.5, yc, zb + 0.35 + 1.2), M["lattice_side"])
        # brackets
        T.box(f"sbracket{s}", (0.45, 0.12, 0.35), (s * 1.28, y0 + 0.06, zb + 2.95), M["carving_fine"], bevel=0.02)
    # layered canopy (eaves) above the opening
    for i in range(5):
        wz = 3.3 + 0.18 * i
        T.box(f"canopy{i}", (wz, 0.35 + 0.08 * i, 0.16), (0, y0 + 0.1 - 0.05 * i, zb + 3.15 + 0.17 * i), M["lattice_fine"] if i % 2 == 0 else M["gold"], bevel=0.01)
    # yellow embroidered valance (帳幔) hanging from the canopy
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=80, y_segments=6, size=0.5)
    bmesh.ops.scale(bm, vec=(2.9, 0.42, 1), verts=bm.verts)
    for v in bm.verts:
        v.co.z = 0.02 * math.sin(v.co.x * 9.0)
        # scalloped hem
        if v.co.y < -0.2:
            v.co.y += 0.05 * (1 - abs(math.sin(v.co.x * math.pi / 0.29)))
    val = T.mesh_obj("valance", bm, M["valance"], smooth=True)
    val.location = (0, y0 - 0.02, zb + 2.95); val.rotation_euler = (math.pi / 2, 0, 0)
    T.box("valance_band", (2.9, 0.012, 0.035), (0, y0 - 0.04, zb + 3.14), M["embroidery"])
    # small palace lanterns inside the shrine
    for s in (-1, 1):
        lat = T.lathe(f"palace{s}", [(0.0, -0.18), (0.08, -0.16), (0.12, -0.08), (0.12, 0.08), (0.08, 0.16), (0.0, 0.18)],
                      (s * 0.95, y0 + 0.35, zb + 2.35), M["lantern_small"], segs=6, smooth=False)
        lat.visible_shadow = False
        T.cylinder(f"palace_cord{s}", 0.004, 0.6, (s * 0.95, y0 + 0.35, zb + 2.85), M["tassel"], segs=6)
        add_point(f"palace_l{s}", (s * 0.95, y0 + 0.35, zb + 2.35), (1.0, 0.45, 0.2), opt("palace", 25.0), 0.08)
    build_mazu(Vector((0, 5.12, zb + 0.35)))
    # warm spots onto the deity
    add_spot("deity_spot", (0, 3.6, 4.6), Vector((0, 5.1, zb + 1.1)), (1.0, 0.72, 0.45), opt("deity", 250.0), 40, 0.3)
    add_point("shrine_fill", (0, 4.7, zb + 2.3), (1.0, 0.6, 0.35), opt("shrinefill", 60.0), 0.5)

    # plaque 有求必應 above the shrine, tilted toward the hall
    pz, py = 5.25, SHRINE_Y0 - 0.05
    tilt = math.radians(14)
    plq = T.box("plaque", (2.3, 0.07, 0.72), (0, py, pz), M["black"], bevel=0.01)
    plq.rotation_euler = (-tilt, 0, 0)
    fr = T.box("plaque_frame", (2.42, 0.06, 0.84), (0, py + 0.02, pz), M["carving_fine"], bevel=0.015)
    fr.rotation_euler = (-tilt, 0, 0)
    tx = T.text("plaque_text", "應必求有", "li", 0.42, (0, py - 0.045 * math.cos(tilt), pz - 0.045 * math.sin(tilt)),
                rot=(math.pi / 2 - tilt, 0, 0), mat=M["gold_bright"], extrude=0.008)
    # traditional plaques read right-to-left, so the string above is reversed on purpose


def build_mazu(base):
    """Seated Mazu (天上聖母): gilt robe with painted borders, black face (黑面媽),
    鳳冠 with a 冕 board and bead curtains, 笏 held before the chest, flame nimbus."""
    x, y, z = base
    T.box("throne", (0.92, 0.62, 0.46), (x, y + 0.05, z + 0.23), M["lattice_fine"], bevel=0.02)
    T.box("throne_seat", (0.96, 0.66, 0.05), (x, y + 0.05, z + 0.47), M["red"], bevel=0.01)
    T.box("throne_back", (1.0, 0.1, 1.3), (x, y + 0.36, z + 0.65), M["lattice_red"], bevel=0.02)
    for s in (-1, 1):
        T.box(f"throne_arm{s}", (0.08, 0.55, 0.3), (x + s * 0.46, y + 0.05, z + 0.62), M["gold"], bevel=0.02)
    # body: robe from seat to shoulders
    robe = T.lathe("robe", [(0.0, 0.0), (0.3, 0.0), (0.31, 0.12), (0.29, 0.34), (0.25, 0.5), (0.215, 0.6), (0.17, 0.66),
                            (0.08, 0.69), (0.0, 0.69)], (x, y + 0.05, z + 0.47), M["robe"], segs=48)
    robe.scale = (1.4, 0.72, 1.0)
    # lap and knees, robe falling over the seat front to the footstool
    T.sphere("lap", 0.28, (x, y - 0.17, z + 0.5), M["robe_plain"], scale=(1.35, 0.95, 0.32))
    for s in (-1, 1):
        T.sphere(f"knee{s}", 0.14, (x + s * 0.17, y - 0.34, z + 0.49), M["robe_plain"], scale=(1.1, 1.1, 0.8))
    skirt = T.lathe("skirt_front", [(0.0, 0.0), (0.3, 0.0), (0.27, 0.2), (0.22, 0.45), (0.0, 0.45)], (x, y - 0.3, z + 0.02), M["robe"], segs=40)
    skirt.scale = (1.25, 0.45, 1.0)
    T.box("footstool", (0.5, 0.22, 0.08), (x, y - 0.42, z + 0.04), M["red"], bevel=0.01)
    for s in (-1, 1):
        T.sphere(f"shoe{s}", 0.06, (x + s * 0.09, y - 0.5, z + 0.1), M["red_dark"], scale=(0.8, 1.6, 0.7))
    # sleeves meeting in front, hands holding the 笏
    for s in (-1, 1):
        sl = T.sphere(f"sleeve{s}", 0.14, (x + s * 0.2, y - 0.2, z + 0.84), M["robe_plain"], scale=(0.75, 1.25, 1.3))
        sl.rotation_euler = (0.3, 0, -s * 0.35)
    T.sphere("hands", 0.055, (x, y - 0.33, z + 0.86), M["mazu_face"], scale=(1.2, 0.8, 0.9))
    T.box("hu", (0.065, 0.018, 0.36), (x, y - 0.36, z + 0.96), M["gold_bright"], bevel=0.005)
    # sash and collar
    T.sphere("sash", 0.2, (x, y - 0.08, z + 0.72), M["red"], scale=(1.25, 0.85, 0.18))
    col = T.lathe("collar", [(0.0, 0.0), (0.15, 0.0), (0.12, 0.05), (0.0, 0.06)], (x, y + 0.04, z + 1.13), M["gold_bright"], segs=32)
    col.scale = (1.3, 0.9, 1.0)
    # head: black face with a hint of gold at the lips and brow
    T.cylinder("neck", 0.055, 0.1, (x, y + 0.03, z + 1.19), M["mazu_face"])
    T.sphere("head", 0.1, (x, y + 0.02, z + 1.31), M["mazu_face"], scale=(0.9, 0.95, 1.15))
    for s in (-1, 1):
        T.sphere(f"ear{s}", 0.028, (x + s * 0.09, y + 0.03, z + 1.31), M["mazu_face"], scale=(0.5, 0.8, 1.4))
    # 鳳冠: tiered crown, phoenix crest, 冕 board and bead curtains front and back
    T.lathe("crown", [(0.0, 0.0), (0.105, 0.0), (0.115, 0.05), (0.1, 0.1), (0.12, 0.15), (0.09, 0.19), (0.0, 0.19)],
            (x, y + 0.02, z + 1.4), M["gold_bright"], segs=36)
    for k in range(7):
        a = math.radians(-60 + k * 20)
        T.sphere(f"crown_orn{k}", 0.028, (x + 0.12 * math.sin(a), y + 0.02 - 0.12 * math.cos(a), z + 1.5), M["gold_bright"] if k % 2 else M["red"], segs=12, rings=8)
    T.sphere("phoenix", 0.05, (x, y - 0.09, z + 1.56), M["gold_bright"], scale=(1.3, 0.6, 1.0))
    T.box("mian", (0.36, 0.28, 0.018), (x, y + 0.02, z + 1.61), M["black"], bevel=0.003)
    T.box("mian_rim", (0.37, 0.29, 0.008), (x, y + 0.02, z + 1.6), M["gold_bright"])
    for side, yy in ((1, y - 0.12), (-1, y + 0.16)):
        for i in range(9):
            xx = x - 0.16 + i * 0.04
            for k in range(8):
                T.sphere(f"bead{side}{i}_{k}", 0.0085, (xx, yy, z + 1.585 - k * 0.026),
                         M["gold_bright"] if (k + i) % 3 else M["red"], segs=8, rings=6)
    # flame nimbus behind the head
    ring = bpy.data.meshes.new("nimbus")
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=False, segments=64, radius=0.3)
    bm.to_mesh(ring); bm.free()
    no = bpy.data.objects.new("nimbus", ring); T.link(no)
    no.location = (x, y + 0.2, z + 1.34); no.rotation_euler = (math.pi / 2, 0, 0)
    sk = no.modifiers.new("skin", "SKIN")
    for vv in ring.skin_vertices[0].data:
        vv.radius = (0.018, 0.018)
    no.modifiers.new("sub", "SUBSURF").levels = 1
    ring.materials.append(M["gold_bright"])
    for k in range(18):
        a = 2 * math.pi * k / 18
        fl = T.cylinder(f"flame_ray{k}", 0.03, 0.09, (x + 0.34 * math.cos(a), y + 0.2, z + 1.34 + 0.34 * math.sin(a)), M["gold"],
                        r2=0.0, segs=8, rot=(0, -a + math.pi / 2, 0))
        fl.rotation_euler = (math.pi / 2, 0, 0)
        fl.rotation_euler.rotate_axis("Y", -a)
    T.cylinder("nimbus_disc", 0.29, 0.01, (x, y + 0.21, z + 1.34), M["red_dark"], rot=(math.pi / 2, 0, 0), segs=64)


def build_offerings():
    zt = TABLE_H
    yc = TABLE_FRONT + TABLE_DEPTH / 2
    # bronze incense burner (香爐)
    bx, by = 0.0, yc + 0.05
    prof = [(0.0, 0.0), (0.15, 0.0), (0.2, 0.04), (0.235, 0.1), (0.24, 0.16), (0.225, 0.2), (0.24, 0.215),
            (0.245, 0.23), (0.215, 0.232), (0.21, 0.21), (0.0, 0.21)]
    burner = T.lathe("burner", prof, (bx, by, zt + 0.07), M["bronze"], segs=64)
    for k in range(3):
        a = math.radians(90 + 120 * k)
        T.cylinder(f"bleg{k}", 0.028, 0.08, (bx + 0.15 * math.cos(a), by + 0.15 * math.sin(a), zt + 0.035), M["bronze"], r2=0.035)
    for s in (-1, 1):
        ear = T.box(f"bear{s}", (0.05, 0.02, 0.09), (bx + s * 0.25, by, zt + 0.33), M["bronze"], bevel=0.008)
    T.cylinder("ash", 0.21, 0.01, (bx, by, zt + 0.07 + 0.205), M["ash"])
    # incense sticks: a few bundles leaning slightly
    for i in range(46):
        r = 0.16 * math.sqrt(random.random()); a = random.random() * 2 * math.pi
        px, py = bx + r * math.cos(a), by + r * math.sin(a)
        tilt = Euler((random.uniform(-0.12, 0.12), random.uniform(-0.12, 0.12), 0))
        L = random.uniform(0.22, 0.33)
        c = T.cylinder(f"stick{i}", 0.0022, L, (0, 0, 0), M["incense"], segs=6)
        st = T.cylinder(f"stickr{i}", 0.0024, 0.09, (0, 0, 0), M["incense_stick"], segs=6)
        tip = T.cylinder(f"tip{i}", 0.0026, 0.012, (0, 0, 0), M["ember"], segs=6) if random.random() < 0.7 else None
        base = Vector((px, py, zt + 0.07 + 0.2))
        up = tilt.to_matrix() @ Vector((0, 0, 1))
        c.location = base + up * (0.07 + L / 2); c.rotation_euler = tilt
        st.location = base + up * 0.035; st.rotation_euler = tilt
        if tip:
            tip.location = base + up * (0.07 + L + 0.004); tip.rotation_euler = tilt
    # candle stands (燭台) with red candles
    for s in (-1, 1):
        cx, cy = s * 0.72, TABLE_FRONT + 0.25
        T.lathe(f"cstand{s}", [(0.09, 0), (0.09, 0.015), (0.035, 0.05), (0.02, 0.1), (0.03, 0.2), (0.018, 0.3), (0.075, 0.34),
                               (0.08, 0.355), (0.0, 0.355)], (cx, cy, zt), M["gold"], segs=40)
        T.cylinder(f"candle{s}", 0.03, 0.26, (cx, cy, zt + 0.355 + 0.13), M["wax"], segs=32)
        T.cylinder(f"wick{s}", 0.0015, 0.015, (cx, cy, zt + 0.355 + 0.26 + 0.007), M["ink"], segs=6)
        fl = T.sphere(f"flame{s}", 0.012, (cx, cy, zt + 0.355 + 0.26 + 0.028), M["flame"], scale=(0.8, 0.8, 2.3))
        fl.visible_shadow = False
        add_point(f"candle_light{s}", (cx, cy, zt + 0.355 + 0.26 + 0.03), (1.0, 0.55, 0.22), opt("candle", 4.0), 0.01)
    # vases with flowers: chrysanthemums (petal rings) + leaves + baby's breath
    mums = {}
    for col in ("fl_yellow", "fl_white", "fl_purple", "fl_pink"):
        bm = bmesh.new()
        for ring, (n, rr, tilt, L) in enumerate(((18, 0.018, 0.25, 0.022), (14, 0.012, 0.7, 0.018), (9, 0.006, 1.1, 0.012))):
            for k in range(n):
                a = 2 * math.pi * (k + 0.5 * ring) / n
                geom = bmesh.ops.create_uvsphere(bm, u_segments=6, v_segments=4, radius=1.0)
                vs = geom["verts"]
                bmesh.ops.scale(bm, vec=(L, 0.004, 0.0025), verts=vs)
                bmesh.ops.translate(bm, vec=(L * 0.9, 0, 0), verts=vs)
                bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(-tilt, 3, "Y"), verts=vs)
                bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(a, 3, "Z"), verts=vs)
                bmesh.ops.translate(bm, vec=(rr * math.cos(a) * 0.3, rr * math.sin(a) * 0.3, 0.0), verts=vs)
        bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=0.009)
        me = bpy.data.meshes.new(f"mum_{col}")
        bm.to_mesh(me); bm.free()
        me.shade_smooth()
        me.materials.append(M[col])
        mums[col] = me
    for s in (-1, 1):
        vx, vy = s * 1.02, TABLE_FRONT + 0.45
        T.lathe(f"vase{s}", [(0.0, 0), (0.07, 0), (0.1, 0.06), (0.11, 0.14), (0.07, 0.24), (0.045, 0.3), (0.06, 0.34), (0.055, 0.345),
                             (0.0, 0.345)], (vx, vy, zt), M["gold"], segs=40)
        for k in range(42):
            a = random.random() * 2 * math.pi; r = random.random() ** 0.6 * 0.2
            hz = zt + 0.38 + random.uniform(0.04, 0.4) * (1 - r / 0.28)
            col = random.choice(["fl_yellow", "fl_yellow", "fl_yellow", "fl_white", "fl_purple", "fl_pink"])
            fo = bpy.data.objects.new(f"mum{s}{k}", mums[col]); T.link(fo)
            fo.location = (vx + r * math.cos(a), vy + r * math.sin(a) * 0.7, hz)
            # heads face outward and up
            fo.rotation_euler = (random.uniform(-0.2, 0.2) - 0.6 * math.sin(a) * r / 0.2, 0.6 * math.cos(a) * r / 0.2, random.random() * 6.28)
            sc = random.uniform(0.85, 1.35); fo.scale = (sc, sc, sc)
        for k in range(26):
            a = random.random() * 2 * math.pi
            lf = T.sphere(f"leaf{s}{k}", 0.07, (vx + 0.14 * math.cos(a), vy + 0.1 * math.sin(a), zt + 0.36 + random.uniform(0, 0.25)), M["leaf"],
                          scale=(1.0, 0.28, 0.05), segs=10, rings=6)
            lf.rotation_euler = (random.uniform(-0.7, 0.7), random.uniform(-0.5, 0.2), a)
        for k in range(60):
            a = random.random() * 2 * math.pi; r = random.random() * 0.25
            T.sphere(f"gyp{s}{k}", 0.006, (vx + r * math.cos(a), vy + r * math.sin(a) * 0.7, zt + 0.42 + random.uniform(0, 0.35) * (1 - r / 0.3)),
                     M["fl_white"], segs=6, rings=4)
    # fruit plates
    for s in (-1, 1):
        px, py = s * 0.42, TABLE_FRONT + 0.62
        T.lathe(f"fplate{s}", [(0.0, 0), (0.1, 0), (0.17, 0.03), (0.18, 0.035), (0.0, 0.02)], (px, py, zt), M["plate"], segs=48)
        k = 0
        for layer, n, r in ((0, 6, 0.1), (1, 3, 0.055), (2, 1, 0.0)):
            for j in range(n):
                a = 2 * math.pi * j / n + layer
                T.sphere(f"fruit{s}{k}", 0.042, (px + r * math.cos(a), py + r * math.sin(a), zt + 0.06 + layer * 0.065),
                         M["orange" if s > 0 else "apple"], segs=20, rings=12)
                k += 1
    # 籤筒 with fortune sticks
    tx, ty = -0.55, TABLE_FRONT + 0.2
    T.cylinder("qiantong", 0.065, 0.22, (tx, ty, zt + 0.11), M["bamboo"], segs=32)
    T.cylinder("qiantong_band", 0.067, 0.02, (tx, ty, zt + 0.19), M["red"], segs=32)
    for i in range(40):
        a = random.random() * 2 * math.pi; r = random.random() * 0.045
        tilt = Euler((random.uniform(-0.18, 0.18), random.uniform(-0.18, 0.18), 0))
        st = T.box(f"qian{i}", (0.008, 0.003, 0.36), (0, 0, 0), M["bamboo"])
        up = tilt.to_matrix() @ Vector((0, 0, 1))
        st.location = Vector((tx + r * math.cos(a), ty + r * math.sin(a), zt + 0.03)) + up * 0.18
        st.rotation_euler = (tilt.x, tilt.y, a)
        if random.random() < 0.8:
            tp = T.box(f"qiantip{i}", (0.009, 0.0035, 0.03), (0, 0, 0), M["red"])
            tp.location = Vector((tx + r * math.cos(a), ty + r * math.sin(a), zt + 0.03)) + up * 0.345
            tp.rotation_euler = st.rotation_euler
    # tray with spare 筊
    jx, jy = 0.5, TABLE_FRONT + 0.2
    T.lathe("jiao_tray", [(0.0, 0), (0.11, 0), (0.16, 0.02), (0.17, 0.028), (0.0, 0.015)], (jx, jy, zt), M["plate"], segs=48)
    jiao = load_jiao()
    if jiao:
        cz = jiao["flat_offset"]
        poses = [((jx - 0.05, jy + 0.03), 0.4, False), ((jx + 0.05, jy - 0.02), 3.3, True), ((jx + 0.01, jy + 0.06), 1.9, True)]
        for i, ((px, py), rz, flip) in enumerate(poses):
            o = jiao["obj"].copy(); T.link(o)
            o.location = (px, py, zt + 0.018 + (0.0235 - cz if flip else cz))
            o.rotation_euler = (math.pi if flip else 0, 0, rz)
    # electric lotus lamps on the upper altar
    for s in (-1, 1):
        for k in range(3):
            lx = s * (0.55 + 0.35 * k)
            T.lathe(f"lotus{s}{k}", [(0.0, 0), (0.05, 0.0), (0.09, 0.05), (0.07, 0.09), (0.0, 0.07)], (lx, ALTAR_Y0 + 0.25, ALTAR_H),
                    T.mat_emission(f"lotus_m{s}{k}", (1.0, 0.35, 0.3), 4.0, (0.6, 0.1, 0.1)), segs=10, smooth=False)
    # big candle lamps (光明燭) on the upper altar
    for s in (-1, 1):
        lx = s * 1.25
        T.cylinder(f"glass{s}", 0.06, 0.45, (lx, ALTAR_Y0 + 0.3, ALTAR_H + 0.225), M["red"], segs=24)
        T.sphere(f"glass_flame{s}", 0.02, (lx, ALTAR_Y0 + 0.3, ALTAR_H + 0.48), M["flame"], scale=(0.8, 0.8, 2.0)).visible_shadow = False
        add_point(f"glass_light{s}", (lx, ALTAR_Y0 + 0.3, ALTAR_H + 0.5), (1.0, 0.55, 0.22), opt("candle", 4.0) * 1.5, 0.02)


def build_lanterns():
    specs = [((-1.1, 2.05, 2.5), 0.3, 0.62, "天上聖母"), ((1.1, 2.05, 2.5), 0.3, 0.62, "天上聖母")]
    for x in (-2.4, -1.2, 0.0, 1.2, 2.4):
        specs.append(((x, 0.75, 3.85), 0.19, 0.4, "平安"))
    for x in (-2.4, -1.2, 0.0, 1.2, 2.4):
        specs.append(((x, -1.2, 3.85), 0.19, 0.4, "平安"))
    for i, ((x, y, z), r, h, words) in enumerate(specs):
        ob = T.sphere(f"lantern{i}", r, (x, y, z), M["lantern" if r > 0.25 else "lantern_small"], scale=(1, 1, h / (2 * r)), segs=48, rings=24)
        ob.visible_shadow = False
        for sgn in (-1, 1):
            T.cylinder(f"lcap{i}{sgn}", r * 0.55, 0.05, (x, y, z + sgn * (h / 2 - 0.005)), M["gold"], segs=32).visible_shadow = False
        T.cylinder(f"lcord{i}", 0.006, HALL_Z - z - h / 2, (x, y, (HALL_Z + z + h / 2) / 2), M["tassel"], segs=6)
        # tassel
        T.cylinder(f"ltassel{i}", r * 0.12, r * 0.9, (x, y, z - h / 2 - r * 0.5), M["tassel"], r2=r * 0.05, segs=16)
        T.sphere(f"lknot{i}", r * 0.1, (x, y, z - h / 2 - 0.02), M["gold"], segs=12, rings=8)
        # black characters wrapped onto the silk
        tx = T.text(f"ltext{i}", T.vertical(words), "kai", r * (0.62 if len(words) == 2 else 0.36), (x, y - r * 1.02, z), mat=M["ink"], extrude=0.0, spacing=1.05)
        sw = tx.modifiers.new("wrap", "SHRINKWRAP"); sw.target = ob; sw.offset = 0.003
        tx.visible_shadow = False
        add_point(f"lantern_light{i}", (x, y, z), (1.0, 0.28, 0.12), opt("lanternlight", 45.0) * (r / 0.3) ** 2, r * 0.6)


def build_guangming():
    """光明燈 walls: rows of small lit niches on both side walls."""
    cell = 0.24
    nx, nz = 17, 10
    for s in (-1, 1):
        x = s * (HALL_X - 0.3)
        y0 = 0.9
        grp_w = nx * cell
        T.box(f"gm_back{s}", (0.1, grp_w + 0.2, nz * cell + 0.2), (x + s * 0.05, y0 + grp_w / 2, 0.55 + nz * cell / 2), M["red_dark"])
        # one lit cell, arrayed
        cellob = T.box(f"gm_cell{s}", (0.03, cell * 0.72, cell * 0.72), (x, y0 + cell / 2, 0.55 + cell / 2), M["light_box"])
        fig = T.sphere(f"gm_fig{s}", cell * 0.14, (x - s * 0.03, y0 + cell / 2, 0.55 + cell / 2 - 0.01), M["gold_bright"], scale=(0.6, 0.8, 1.3), segs=12, rings=8)
        frame = T.box(f"gm_frame{s}", (0.05, cell * 0.96, cell * 0.96), (x + s * 0.01, y0 + cell / 2, 0.55 + cell / 2), M["gold"])
        for o in (cellob, fig, frame):
            a1 = o.modifiers.new("ay", "ARRAY"); a1.use_relative_offset = False; a1.use_constant_offset = True
            a1.constant_offset_displace = (0, cell / (o.scale.y), 0); a1.count = nx
            a2 = o.modifiers.new("az", "ARRAY"); a2.use_relative_offset = False; a2.use_constant_offset = True
            a2.constant_offset_displace = (0, 0, cell / (o.scale.z)); a2.count = nz


def build_floor_items():
    # kneeling stools (拜墊) at the sides of the throwing area
    for i, (x, y, rz) in enumerate(((-1.35, 1.15, 0.05), (1.4, 1.35, -0.08), (-1.3, 0.2, 0.0))):
        fr = T.box(f"stool{i}", (0.5, 0.36, 0.12), (x, y, 0.06), M["darkwood"], bevel=0.01, rot=(0, 0, rz))
        cu = T.box(f"stool_c{i}", (0.46, 0.32, 0.09), (x, y, 0.16), M["cushion"], bevel=0.035, rot=(0, 0, rz), segs=4)
    # an ash-dusted metal bucket of joss paper near the left pillar
    T.cylinder("paper_bin", 0.16, 0.3, (-2.5, 3.6, 0.15), M["bronze"], segs=32)


# ======================================================================= lights / helpers
def add_point(name, loc, color, power, radius):
    ld = bpy.data.lights.new(name, "POINT"); ld.energy = power; ld.color = color
    ld.shadow_soft_size = radius
    ob = bpy.data.objects.new(name, ld); ob.location = loc
    T.link(ob)
    return ob


def add_spot(name, loc, target, color, power, angle_deg, radius):
    ld = bpy.data.lights.new(name, "SPOT"); ld.energy = power; ld.color = color
    ld.spot_size = math.radians(angle_deg); ld.spot_blend = 0.6; ld.shadow_soft_size = radius
    ob = bpy.data.objects.new(name, ld); ob.location = loc
    ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    T.link(ob)
    return ob


def add_area(name, loc, target, color, power, sx, sy):
    ld = bpy.data.lights.new(name, "AREA"); ld.energy = power; ld.color = color
    ld.shape = "RECTANGLE"; ld.size = sx; ld.size_y = sy
    ob = bpy.data.objects.new(name, ld); ob.location = loc
    ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    T.link(ob)
    return ob


def build_lights():
    # temple spotlights from the beam, aimed at the offering table and the floor in front of it
    add_spot("table_spot", (0, 0.6, HALL_Z - 0.6), Vector((0, 2.5, 0.5)), (1.0, 0.8, 0.6), opt("tablespot", 160.0), 55, 0.15)
    # warm overhead fill (hall lamps)
    for x, y in ((-1.6, 1.0), (1.6, 1.0), (0, 2.8), (-1.6, -1.5), (1.6, -1.5)):
        add_area(f"ceil{x}{y}", (x, y, HALL_Z - 0.6), (x, y, 0), (1.0, 0.78, 0.55), opt("ceil", 12.0), 0.8, 0.8)


_JIAO = None


def load_jiao():
    global _JIAO
    if _JIAO is not None:
        return _JIAO
    path = os.path.join(HERE, "jiao.blend")
    if not os.path.exists(path):
        _JIAO = {}
        return _JIAO
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n in ("Jiao", "JiaoB")]
    info = json.load(open(os.path.join(ASSETS, "jiao_colliders.json")))
    objs = {o.name: o for o in dst.objects if o}
    _JIAO = dict(obj=objs.get("Jiao"), objB=objs.get("JiaoB"), flat_offset=info["flat_offset"], H=info["H"])
    return _JIAO


# ======================================================================= camera / render
def make_camera(pitch_deg=-30.0, yaw_deg=0.0, lens=24.0, focus=None, fstop=None):
    cd = bpy.data.cameras.new("cam")
    cd.sensor_fit = "HORIZONTAL"; cd.sensor_width = 36.0; cd.lens = lens
    cam = bpy.data.objects.new("cam", cd); T.link(cam)
    cam.location = EYE
    cam.rotation_euler = Euler((math.radians(90 + pitch_deg), 0, math.radians(yaw_deg)), "XYZ")
    bpy.context.scene.camera = cam
    if focus:
        cd.dof.use_dof = True; cd.dof.focus_distance = focus; cd.dof.aperture_fstop = fstop or 2.8
    return cam


def render(path, w, h, samples, denoise=True):
    sc = bpy.context.scene
    sc.render.resolution_x = w; sc.render.resolution_y = h; sc.render.resolution_percentage = 100
    sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.01
    sc.cycles.use_denoising = denoise
    sc.cycles.denoiser = "OPENIMAGEDENOISE"
    sc.render.filepath = path
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_depth = "8"
    bpy.ops.render.render(write_still=True)


def build_all():
    sc = setup()
    materials()
    build_room(); build_pillars(); build_tables(); build_shrine(); build_offerings()
    build_lanterns(); build_guangming(); build_floor_items(); build_lights()
    return sc


def b2t(v):
    """Blender (x, y, z) -> three.js (x, z, -y)"""
    return [round(float(v[0]), 5), round(float(v[2]), 5), round(float(-v[1]), 5)]


PANO = dict(lonMin=-55.0, lonMax=55.0, latMin=-78.0, latMax=48.0)
# straight-down rectilinear plate: covers the floor all around the viewer, where the
# equirectangular crop runs out (screen corners when looking down at the landing zone)
NADIR = dict(fov=110.0, size=2048)
PROBE_POS = Vector((0.0, 1.3, 0.12))
FOCUS, FSTOP = 1.45, 4.5


def statics():
    """Physics colliders in three.js coordinates, matching the modelled furniture."""
    out = []
    y0 = TABLE_FRONT - 0.07  # skirt + fringe stand proud of the table front
    out.append(dict(name="table", type="box", center=b2t((0, (y0 + TABLE_FRONT + TABLE_DEPTH) / 2, TABLE_H / 2)),
                    half=[TABLE_W / 2, TABLE_H / 2, (TABLE_FRONT + TABLE_DEPTH - y0) / 2], friction=0.6, restitution=0.15))
    out.append(dict(name="altar", type="box", center=b2t((0, (ALTAR_Y0 + ALTAR_Y1) / 2, ALTAR_H / 2)),
                    half=[ALTAR_W / 2, ALTAR_H / 2, (ALTAR_Y1 - ALTAR_Y0) / 2], friction=0.5, restitution=0.3))
    for s in (-1, 1):
        out.append(dict(name="pillar", type="cylinder", center=b2t((s * PILLAR_X, PILLAR_Y, 1.0)), radius=0.34, halfHeight=1.0, restitution=0.35))
        out.append(dict(name="pillar", type="cylinder", center=b2t((s * 3.4, 0.4, 1.0)), radius=0.37, halfHeight=1.0, restitution=0.35))
    for (x, y, rz) in ((-1.35, 1.15, 0.05), (1.4, 1.35, -0.08), (-1.3, 0.2, 0.0)):
        out.append(dict(name="stool", type="box", center=b2t((x, y, 0.105)), half=[0.25, 0.105, 0.18], rotY=rz, friction=0.7, restitution=0.12))
    out.append(dict(name="bin", type="cylinder", center=b2t((-2.5, 3.6, 0.15)), radius=0.16, halfHeight=0.15))
    for s in (-1, 1):
        out.append(dict(name="wall", type="box", center=b2t((s * (HALL_X + 0.15), (HALL_Y0 + HALL_Y1) / 2, 2)), half=[0.15, 2, (HALL_Y1 - HALL_Y0) / 2]))
    out.append(dict(name="wall", type="box", center=b2t((0, HALL_Y1 + 0.15, 2)), half=[HALL_X, 2, 0.15]))
    out.append(dict(name="wall", type="box", center=b2t((0, HALL_Y0 - 0.15, 2)), half=[HALL_X, 2, 0.15]))
    return out


def scene_json(w, h):
    zt = TABLE_H
    flames = [b2t((s * 0.72, TABLE_FRONT + 0.25, zt + 0.355 + 0.26 + 0.03)) for s in (-1, 1)]
    flames += [b2t((s * 1.25, ALTAR_Y0 + 0.3, ALTAR_H + 0.49)) for s in (-1, 1)]
    data = dict(
        eye=b2t(EYE),
        pano=dict(file="pano.webp", preview="pano_small.webp", width=w, height=h, **PANO),
        nadir=dict(file="nadir.webp", **NADIR),
        probe=dict(file="probe.hdr", pos=b2t(PROBE_POS)),
        statics=statics(),
        focus=FOCUS,
        lights=dict(
            spot=b2t((0, 0.6, HALL_Z - 0.6)),
            door=b2t((0, HALL_Y0 - 0.35, 1.7)),
        ),
        smoke=b2t((0.0, TABLE_FRONT + TABLE_DEPTH / 2 + 0.05, zt + 0.07 + 0.3)),
        flames=flames,
        table=dict(front=-TABLE_FRONT, height=TABLE_H),
        lamps=export_lamps(),
    )
    with open(os.path.join(ASSETS, "scene.json"), "w") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)


def export_lamps():
    """Every Blender light, for real-time re-creation (the probe cannot see them)."""
    bpy.context.view_layer.update()
    out = []
    for o in bpy.context.scene.objects:
        if o.type != "LIGHT":
            continue
        L = o.data
        fwd = o.matrix_world.to_3x3() @ Vector((0, 0, -1))
        up = o.matrix_world.to_3x3() @ Vector((0, 1, 0))
        e = dict(name=o.name, type=L.type, pos=b2t(o.matrix_world.translation), power=L.energy,
                 color=[round(c, 4) for c in L.color], dir=b2t(fwd), radius=getattr(L, "shadow_soft_size", 0.0))
        if L.type == "SPOT":
            e.update(angle=L.spot_size, blend=L.spot_blend)
        if L.type == "AREA":
            e.update(sx=L.size, sy=L.size_y if L.shape in ("RECTANGLE", "ELLIPSE") else L.size, up=b2t(up))
        out.append(e)
    return out


def pano_camera():
    cd = bpy.data.cameras.new("pano")
    cd.type = "PANO"
    cd.panorama_type = "EQUIRECTANGULAR"
    cd.longitude_min = math.radians(PANO["lonMin"]); cd.longitude_max = math.radians(PANO["lonMax"])
    cd.latitude_min = math.radians(PANO["latMin"]); cd.latitude_max = math.radians(PANO["latMax"])
    cd.lens = 24.0
    if opt("dof", 1):
        cd.dof.use_dof = True; cd.dof.focus_distance = FOCUS; cd.dof.aperture_fstop = FSTOP
    cam = bpy.data.objects.new("pano", cd); T.link(cam)
    cam.location = EYE
    cam.rotation_euler = Euler((math.radians(90), 0, 0))
    bpy.context.scene.camera = cam
    return cam


def add_bloom():
    """Soft bloom around flames and lanterns (Blender 5 compositor)."""
    sc = bpy.context.scene
    try:
        ng = bpy.data.node_groups.new("comp", "CompositorNodeTree")
        sc.compositing_node_group = ng
        rl = ng.nodes.new("CompositorNodeRLayers")
        gl = ng.nodes.new("CompositorNodeGlare")
        ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        out = ng.nodes.new("NodeGroupOutput")
        names = {s.name: s for s in gl.inputs}
        print("glare inputs:", list(names))
        if "Type" in names:
            names["Type"].default_value = "Bloom"
        else:
            gl.glare_type = "BLOOM"
        for k, v in (("Threshold", opt("bloom_th", 1.0)), ("Strength", opt("bloom", 0.22)), ("Size", 0.6), ("Smoothness", 0.4)):
            if k in names:
                try:
                    names[k].default_value = v
                except Exception as e:
                    print("glare", k, e)
        ng.links.new(rl.outputs["Image"], gl.inputs["Image"])
        ng.links.new(gl.outputs["Image"], out.inputs[0])
        print("bloom on")
    except Exception as e:
        print("bloom skipped:", e)


def save_webp(png_path, webp_path, quality=90, scale=1.0):
    img = bpy.data.images.load(png_path)
    if scale != 1.0:
        img.scale(int(img.size[0] * scale), int(img.size[1] * scale))
    sc = bpy.context.scene
    # the PNG is already display-referred: save it through an identity transform
    vt, look, ex = sc.view_settings.view_transform, sc.view_settings.look, sc.view_settings.exposure
    sc.view_settings.view_transform = "Standard"; sc.view_settings.look = "None"; sc.view_settings.exposure = 0
    s = sc.render.image_settings
    s.file_format = "WEBP"; s.quality = quality; s.color_mode = "RGB"
    img.save_render(webp_path, scene=sc)
    s.file_format = "PNG"
    sc.view_settings.view_transform, sc.view_settings.look, sc.view_settings.exposure = vt, look, ex


def place_ref_blocks():
    """Two blocks at fixed poses for the Blender vs three.js comparison."""
    jiao = load_jiao()
    cz, H = jiao["flat_offset"], jiao["H"]
    poses = json.load(open(os.path.join(HERE, "ref_poses.json")))
    objs = []
    for i, p in enumerate(poses):
        o = (jiao["obj"] if i == 0 else jiao["objB"]).copy(); T.link(o)
        # pose given in three.js coordinates: position + quaternion (x, y, z, w)
        from mathutils import Quaternion, Matrix
        px, py, pz = p["p"]; qx, qy, qz, qw = p["q"]
        C = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))  # three -> blender basis change
        Rt = Quaternion((qw, qx, qy, qz)).to_matrix()
        Rb = C @ Rt @ C.transposed()
        # the glTF import frame of the mesh: blender mesh local = C @ three local
        o.matrix_world = Matrix.Translation((px, -pz, py)) @ Rb.to_4x4()
        objs.append(o)
    return objs


def main():
    sc = build_all()
    if MODE == "preview":
        w, h, spp = opt("w", 1200), opt("h", 800), opt("spp", 64)
        tag = opt("tag", "")
        for name, pitch, lens in (("idle", opt("pitch_idle", 1.0), 20.0), ("floor", -34.0, 24.0), ("land", -40.0, 40.0)):
            if opt("only", "") and opt("only", "") != name:
                continue
            make_camera(pitch, 0, lens, focus=opt("focus", 0.0) or None, fstop=opt("fstop", 2.8))
            render(os.path.join(RENDERS, f"temple_{name}{tag}.png"), w, h, spp)
    elif MODE == "pano":
        ppd = opt("ppd", 28.0)
        w = int(round((PANO["lonMax"] - PANO["lonMin"]) * ppd)); h = int(round((PANO["latMax"] - PANO["latMin"]) * ppd))
        pano_camera()
        if opt("bloom", 0.35) > 0:
            add_bloom()
        png = os.path.join(RENDERS, "pano.png")
        render(png, w, h, opt("spp", 256))
        save_webp(png, os.path.join(ASSETS, "pano.webp"), opt("q", 88))
        save_webp(png, os.path.join(ASSETS, "pano_small.webp"), 70, 0.25)
        scene_json(w, h)
    elif MODE == "nadir":
        cd = bpy.data.cameras.new("nadir")
        cd.sensor_fit = "HORIZONTAL"; cd.sensor_width = 36.0
        cd.lens = 18.0 / math.tan(math.radians(NADIR["fov"] / 2))
        cam = bpy.data.objects.new("nadir", cd); T.link(cam)
        cam.location = EYE
        cam.rotation_euler = Euler((0, 0, 0))  # looks down -Z, image up = +Y (toward the altar)
        sc.camera = cam
        # the floor is a plane square to this camera's axis: focusing on it keeps it sharp,
        # matching the in-focus landing zone of the panorama
        cd.dof.use_dof = False
        if opt("bloom", 0.22) > 0:
            add_bloom()
        png = os.path.join(RENDERS, "nadir.png")
        render(png, NADIR["size"], NADIR["size"], opt("spp", 256))
        save_webp(png, os.path.join(ASSETS, "nadir.webp"), opt("q", 86))
    elif MODE == "webp":
        png = os.path.join(RENDERS, "pano.png")
        save_webp(png, os.path.join(ASSETS, "pano.webp"), opt("q", 88))
        save_webp(png, os.path.join(ASSETS, "pano_small.webp"), 70, 0.25)
    elif MODE == "meta":
        ppd = opt("ppd", 28.0)
        scene_json(int(round((PANO["lonMax"] - PANO["lonMin"]) * ppd)), int(round((PANO["latMax"] - PANO["latMin"]) * ppd)))
    elif MODE == "probe":
        cd = bpy.data.cameras.new("probe"); cd.type = "PANO"; cd.panorama_type = "EQUIRECTANGULAR"
        cd.longitude_min = -math.pi; cd.longitude_max = math.pi; cd.latitude_min = -math.pi / 2; cd.latitude_max = math.pi / 2
        cam = bpy.data.objects.new("probe", cd); T.link(cam)
        cam.location = PROBE_POS
        # look along +X so the image matches three.js' equirect convention (u=0.5 -> +X)
        cam.rotation_euler = Euler((math.radians(90), 0, math.radians(-90)))
        sc.camera = cam
        sc.render.resolution_x = opt("w", 1024); sc.render.resolution_y = opt("w", 1024) // 2
        sc.cycles.samples = opt("spp", 256); sc.cycles.use_denoising = True
        sc.view_settings.view_transform = "Standard"
        sc.render.image_settings.file_format = "HDR"
        sc.render.filepath = os.path.join(ASSETS, "probe.hdr")
        bpy.ops.render.render(write_still=True)
    elif MODE == "ref":
        place_ref_blocks()
        lens = opt("lens", 30.0)
        # same aperture diameter as the 24 mm f/4.5 panorama
        make_camera(opt("pitch", -36.0), 0, lens, focus=FOCUS, fstop=FSTOP * lens / 24.0)
        if opt("bloom", 0.22) > 0:
            add_bloom()
        render(os.path.join(RENDERS, "ref_blender.png"), opt("w", 1280), opt("h", 720), opt("spp", 256))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, f"temple_{MODE}.blend"))


main()
