import json, os, glob

overrides_dir = "/Users/xin/Study/HeiView/heiView_github/data/2026SS/overrides"
orig_dir = "/Users/xin/Study/HeiView/heiView_github/data/2026SS"

# For each override, find weeks where location=="Siehe Anmerkung" (or similar vague location)
# and there's a note + room + building filled in.
# Collect: note -> (room, building) mappings

mappings = {}  # note -> set of (room, building)

vague_locations = {"Siehe Anmerkung", "siehe Anmerkung", "s. Anmerkung", "N.N.", ""}

for path in sorted(glob.glob(os.path.join(overrides_dir, "*.json"))):
    with open(path) as f:
        data = json.load(f)
    for week in data.get("weeks", []):
        loc = week.get("location", "")
        note = week.get("note", "")
        room = week.get("room", "")
        building = week.get("building", "")
        
        # Only interested in weeks where we have a note and meaningful room/building
        if note and room and building and room != loc:
            key = note.strip()
            val = (room.strip(), building.strip())
            if key not in mappings:
                mappings[key] = set()
            mappings[key].add(val)

print(f"Found {len(mappings)} unique note strings\n")
for note, vals in sorted(mappings.items()):
    print(f"NOTE: {repr(note)}")
    for room, building in sorted(vals):
        print(f"  room:     {room}")
        print(f"  building: {building}")
    print()
