"""Export the Pokédex used by the server and the six official XP tables."""
import csv
import io
import json
from pathlib import Path
import sqlite3
from urllib.request import urlopen

root = Path(__file__).resolve().parents[1]
db = sqlite3.connect(root.parent / "pokedex.sqlite")
db.row_factory = sqlite3.Row
mons = {}
for row in db.execute("""
    SELECT p.id, p.identifier AS slug, p.species_id AS speciesId,
           s.identifier AS baseSlug, p.is_default AS isDefault,
           s.gender_rate AS genderRate, s.capture_rate AS catchRate,
           s.base_happiness AS happiness, s.growth_rate_id AS growth,
           p.base_experience AS baseXp, s.evolves_from_species_id AS parent,
           s.is_legendary OR s.is_mythical AS rare
    FROM national_pokemon p JOIN national_species s ON s.id = p.species_id
"""):
    mons[row["id"]] = dict(row, stats=[], types=[], abilities=[], moves=[], forms=[])
for pid, stat, base in db.execute("SELECT pokemon_id,stat_id,base_stat FROM pokemon_stats ORDER BY stat_id"):
    if pid in mons and stat <= 6:
        mons[pid]["stats"].append(base)
for pid, slug in db.execute("SELECT t.pokemon_id,n.identifier FROM pokemon_types t JOIN types n ON n.id=t.type_id ORDER BY t.slot"):
    mons[pid]["types"].append(slug)
for pid, slug in db.execute("SELECT a.pokemon_id,n.identifier FROM pokemon_abilities a JOIN abilities n ON n.id=a.ability_id WHERE a.is_hidden=0 ORDER BY a.slot"):
    mons[pid]["abilities"].append(slug)
for pid, level, slug, power in db.execute("""
    SELECT l.pokemon_id,l.level,m.identifier,m.power FROM game_learnsets l JOIN moves m ON m.id=l.move_id
    WHERE l.pokemon_move_method_id=1 ORDER BY l.level, l."order", m.id
"""):
    mons[pid]["moves"].append((level, slug))
for pid, fid in db.execute("SELECT pokemon_id,id FROM national_forms"):
    mons[pid]["forms"].append(fid)
rules = []
for row in db.execute("""
    SELECT e.*, s.evolves_from_species_id AS parent, tr.identifier AS trigger,
           it.identifier AS item, hi.identifier AS heldItem, mv.identifier AS knownMove,
           kt.identifier AS knownType, pt.identifier AS partyType,
           um.identifier AS usedMove, nf.pokemon_id AS targetPokemon,
           rf.pokemon_id AS requiredPokemon
    FROM pokemon_evolution e
    JOIN national_species s ON s.id=e.evolved_species_id
    JOIN evolution_triggers tr ON tr.id=e.evolution_trigger_id
    LEFT JOIN items it ON it.id=e.trigger_item_id LEFT JOIN items hi ON hi.id=e.held_item_id
    LEFT JOIN moves mv ON mv.id=e.known_move_id LEFT JOIN types kt ON kt.id=e.known_move_type_id
    LEFT JOIN types pt ON pt.id=e.party_type_id LEFT JOIN moves um ON um.id=e.used_move_id
    LEFT JOIN pokemon_forms nf ON nf.id=e.evolved_pokemon_form_id
    LEFT JOIN pokemon_forms rf ON rf.id=e.required_pokemon_form_id
    WHERE e.is_default=1
"""):
    rules.append({k:v for k,v in dict(row).items() if v is not None})
revision = db.execute("SELECT value FROM source_metadata WHERE key='revision'").fetchone()[0]
url = f"https://raw.githubusercontent.com/PokeAPI/pokeapi/{revision}/data/v2/csv/experience.csv"
growth = {}
with urlopen(url, timeout=30) as source:
    for row in csv.DictReader(io.TextIOWrapper(source, encoding="utf-8")):
        values = growth.setdefault(row["growth_rate_id"], [0])
        values.append(int(row["experience"]))
assert len(growth) == 6 and all(len(v) == 101 for v in growth.values())
dest = root / "data" / "rules.json"
dest.parent.mkdir(exist_ok=True)
dest.write_text(json.dumps(dict(revision=revision, mons=list(mons.values()), growth=growth, evolution=rules),
                           ensure_ascii=False,separators=(",",":")), encoding="utf-8")
