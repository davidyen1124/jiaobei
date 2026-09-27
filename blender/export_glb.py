"""Re-export jiao.glb from jiao.blend with textures downsized for the web.
Run: Blender -b jiao.blend -P export_glb.py -- [size]"""
import bpy, sys, os
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
size = int(ARGS[0]) if ARGS else 1024
out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "assets", "jiao.glb")
done = set()
for m in bpy.data.materials:
    if not m.node_tree:
        continue
    for n in m.node_tree.nodes:
        if n.type == "TEX_IMAGE" and n.image and n.image.name not in done:
            if n.image.size[0] > size:
                n.image.scale(size, size)
            done.add(n.image.name)
# both blocks share one geometry: ship block B's material on a one-triangle carrier
b = bpy.data.objects["JiaoB"]
tri = bpy.data.meshes.new("JiaoB_material")
tri.from_pydata([(0, 0, 0), (0.001, 0, 0), (0, 0.001, 0)], [], [(0, 1, 2)])
tri.uv_layers.new(name="UVMap")
tri.materials.append(b.data.materials[0])
carrier = bpy.data.objects.new("JiaoB_material", tri)
bpy.context.scene.collection.objects.link(carrier)
for o in bpy.context.scene.objects:
    o.select_set(o.name in ("Jiao", "JiaoB_material"))
    if o.name in ("Jiao", "JiaoB_material"):
        o.location = (0, 0, 0); o.rotation_euler = (0, 0, 0)
bpy.ops.export_scene.gltf(filepath=out, use_selection=True, export_format="GLB", export_image_format="WEBP",
                          export_image_quality=90, export_yup=True, export_apply=True, export_materials="EXPORT")
print("exported", out, sorted(done))
