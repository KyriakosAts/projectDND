"""
game_logic.py - Hero Quest: Digital Edition
Core game state management, combat, AI, and pathfinding.
"""

import json
import random
import copy
import os
from collections import deque

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
SAVE_FILE = os.path.join(os.path.dirname(__file__), "savegame.json")

# ---------------------------------------------------------------------------
# Dice helpers
# ---------------------------------------------------------------------------

SKULL  = "skull"
SHIELD = "shield"
BLANK  = "blank"

# HeroQuest combat die: 2 skulls, 2 shields, 2 blanks per 6 sides
_COMBAT_FACE = [SKULL, SKULL, SHIELD, SHIELD, BLANK, BLANK]


def roll_die():
    return random.choice(_COMBAT_FACE)


def roll_combat_dice(attack_dice: int, defend_dice: int) -> dict:
    """Roll attack and defend dice, return outcome."""
    attack_rolls = [roll_die() for _ in range(max(0, attack_dice))]
    defend_rolls = [roll_die() for _ in range(max(0, defend_dice))]

    skulls  = attack_rolls.count(SKULL)
    shields = defend_rolls.count(SHIELD)

    damage = max(0, skulls - shields)
    return {
        "attack_rolls": attack_rolls,
        "defend_rolls": defend_rolls,
        "skulls":  skulls,
        "shields": shields,
        "hit":     damage > 0,
        "damage":  damage,
    }


# ---------------------------------------------------------------------------
# Pathfinding (BFS)
# ---------------------------------------------------------------------------

def bfs_reachable(grid, start_x, start_y, max_steps, occupied, passable_occupied=None):
    """
    Return dict of {(x,y): steps} for every reachable tile within max_steps.
    occupied       - set of (x,y) that CANNOT be landed on (enemies, walls blocked already).
    passable_occupied - set of (x,y) that can be passed THROUGH but not landed on (ally heroes).
    Doors (tile 2) are passable. Traps (tile 3) are passable but harmful.
    """
    if passable_occupied is None:
        passable_occupied = set()

    rows = len(grid)
    cols = len(grid[0]) if rows else 0
    visited = {(start_x, start_y): 0}
    queue = deque([(start_x, start_y, 0)])
    reachable = {}

    while queue:
        x, y, steps = queue.popleft()
        # Only add to reachable if not an occupied landing tile
        if steps > 0 and (x, y) not in occupied and (x, y) not in passable_occupied:
            reachable[(x, y)] = steps

        if steps >= max_steps:
            continue

        for dx, dy in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            nx, ny = x + dx, y + dy
            if 0 <= ny < rows and 0 <= nx < cols:
                tile = grid[ny][nx]
                # Can traverse through passable_occupied tiles but not wall or hard-occupied
                if tile != 1 and (nx, ny) not in visited and (nx, ny) not in occupied:
                    visited[(nx, ny)] = steps + 1
                    queue.append((nx, ny, steps + 1))

    return reachable


def bfs_path(grid, start_x, start_y, goal_x, goal_y, occupied):
    """Return shortest path [(x,y)...] from start to goal, or [] if unreachable."""
    rows = len(grid)
    cols = len(grid[0]) if rows else 0

    if (start_x, start_y) == (goal_x, goal_y):
        return []

    visited = {(start_x, start_y): None}
    queue = deque([(start_x, start_y)])

    while queue:
        x, y = queue.popleft()
        if (x, y) == (goal_x, goal_y):
            break
        for dx, dy in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            nx, ny = x + dx, y + dy
            if 0 <= ny < rows and 0 <= nx < cols:
                tile = grid[ny][nx]
                if tile != 1 and (nx, ny) not in visited and (nx, ny) not in occupied:
                    visited[(nx, ny)] = (x, y)
                    queue.append((nx, ny))

    if (goal_x, goal_y) not in visited:
        return []

    path = []
    cur = (goal_x, goal_y)
    while cur != (start_x, start_y):
        path.append(cur)
        cur = visited[cur]
    path.reverse()
    return path


# ---------------------------------------------------------------------------
# Chebyshev / Manhattan range helpers
# ---------------------------------------------------------------------------

def manhattan(x1, y1, x2, y2):
    return abs(x1 - x2) + abs(y1 - y2)


def in_range(x1, y1, x2, y2, weapon_range):
    return manhattan(x1, y1, x2, y2) <= weapon_range


# ---------------------------------------------------------------------------
# Spell definitions
# ---------------------------------------------------------------------------

SPELLS = {
    "firebolt": {
        "name": "Firebolt",
        "mp_cost": 0,
        "range": 5,
        "attack_dice": 3,
        "defend_dice": 0,
        "effect": "damage",
        "description": "A bolt of fire streaks toward the target!",
    },
    "ice_shard": {
        "name": "Ice Shard",
        "mp_cost": 0,
        "range": 4,
        "attack_dice": 2,
        "defend_dice": 0,
        "effect": "damage",
        "description": "Razor-sharp ice shards pierce the target!",
    },
    "heal": {
        "name": "Heal",
        "mp_cost": 0,
        "range": 1,
        "heal_amount": 2,
        "effect": "heal",
        "description": "A warm glow restores the target's wounds.",
    },
}


# ---------------------------------------------------------------------------
# GameState class
# ---------------------------------------------------------------------------

class GameState:
    """Full mutable game state for one session."""

    def __init__(self):
        self.heroes   = []
        self.enemies  = []
        self.map_data = {}
        self.quest    = {}
        self.log      = []

        # Turn tracking
        self.turn_order    = []   # list of entity ids (heroes first)
        self.current_turn  = 0   # index into turn_order
        self.phase         = "hero"   # "hero" | "dm"
        self.hero_index    = 0   # which hero's turn it is
        self.action_taken  = False    # hero has acted this turn
        self.moved         = False    # hero has moved this turn
        self.attacked      = False    # hero has attacked this turn
        self.game_over     = False
        self.victory       = False
        self.round_number  = 1

    # ------------------------------------------------------------------
    # Initialization
    # ------------------------------------------------------------------

    def new_game(self):
        """Load all data files and initialise a fresh game."""
        with open(os.path.join(DATA_DIR, "heroes.json"))  as f:
            self.heroes = json.load(f)
        with open(os.path.join(DATA_DIR, "enemies.json")) as f:
            self.enemies = json.load(f)
        with open(os.path.join(DATA_DIR, "map.json"))     as f:
            self.map_data = json.load(f)
        with open(os.path.join(DATA_DIR, "quests.json"))  as f:
            self.quest = json.load(f)

        # Reset per-game state fields on each entity
        for h in self.heroes:
            h["hp"]           = h["max_hp"]
            h["alive"]        = True
            h["has_moved"]    = False
            h["has_attacked"] = False
            h["status"]       = []  # status effects

        for e in self.enemies:
            e["hp"]           = e["max_hp"]
            e["alive"]        = True
            e["has_moved"]    = False
            e["has_attacked"] = False

        self.hero_index   = 0
        self.phase        = "hero"
        self.moved        = False
        self.attacked     = False
        self.game_over    = False
        self.victory      = False
        self.round_number = 1
        self.log          = []

        quest_data = self.quest["quests"][self.quest["current_quest"]]
        self._log(quest_data["intro_text"], "quest")
        self._log(f"Round {self.round_number} begins! {self._current_hero()['name']}'s turn.", "info")

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _log(self, message: str, category: str = "info"):
        self.log.append({"message": message, "category": category})

    def _grid(self):
        return self.map_data["tiles"]

    def _occupied_enemies(self):
        """Return set of (x,y) occupied by living enemies only."""
        return {(e["x"], e["y"]) for e in self.enemies if e.get("alive")}

    def _occupied_heroes(self, exclude_id=None):
        """Return set of (x,y) occupied by living heroes (optionally excluding one)."""
        return {(h["x"], h["y"]) for h in self.heroes if h.get("alive") and h["id"] != exclude_id}

    def _occupied(self, exclude_id=None):
        """Return set of (x,y) occupied by ANY living character."""
        return self._occupied_enemies() | self._occupied_heroes(exclude_id)

    def _current_hero(self):
        alive_heroes = [h for h in self.heroes if h.get("alive")]
        if not alive_heroes:
            return None
        idx = self.hero_index % len(alive_heroes)
        return alive_heroes[idx]

    def _get_hero(self, hero_id):
        for h in self.heroes:
            if h["id"] == hero_id:
                return h
        return None

    def _get_enemy(self, enemy_id):
        for e in self.enemies:
            if e["id"] == enemy_id:
                return e
        return None

    def _get_entity_at(self, x, y):
        for h in self.heroes:
            if h.get("alive") and h["x"] == x and h["y"] == y:
                return ("hero", h)
        for e in self.enemies:
            if e.get("alive") and e["x"] == x and e["y"] == y:
                return ("enemy", e)
        return None

    def _check_trap(self, entity, x, y):
        """If the tile at (x,y) is a trap, apply damage."""
        grid = self._grid()
        if grid[y][x] == 3:
            self._log(f"⚠ {entity['name']} triggers a TRAP!", "trap")
            result = roll_combat_dice(2, entity.get("defend_dice", 1))
            if result["hit"]:
                entity["hp"] = max(0, entity["hp"] - result["damage"])
                self._log(
                    f"  The trap deals {result['damage']} damage! "
                    f"({entity['name']} HP: {entity['hp']}/{entity['max_hp']})",
                    "damage"
                )
                if entity["hp"] <= 0:
                    self._kill_entity(entity)
            else:
                self._log("  The trap snaps shut but misses!", "info")

    def _kill_entity(self, entity):
        entity["alive"] = False
        entity["hp"]    = 0
        self._log(f"💀 {entity['name']} has been defeated!", "death")

    def _check_victory(self):
        alive_enemies = [e for e in self.enemies if e.get("alive")]
        if not alive_enemies:
            self.game_over = True
            self.victory   = True
            quest_data = self.quest["quests"][self.quest["current_quest"]]
            self._log(quest_data["complete_text"], "quest")
            return True
        alive_heroes = [h for h in self.heroes if h.get("alive")]
        if not alive_heroes:
            self.game_over = True
            self.victory   = False
            self._log("All heroes have fallen! The dungeon claims another band of adventurers...", "death")
            return True
        return False

    def _advance_hero_turn(self):
        """Move to the next living hero, or switch to DM phase."""
        alive_heroes = [h for h in self.heroes if h.get("alive")]
        if not alive_heroes:
            return

        # reset current hero's flags
        current = self._current_hero()
        if current:
            current["has_moved"]    = False
            current["has_attacked"] = False

        self.hero_index = (self.hero_index + 1) % len(alive_heroes)
        self.moved      = False
        self.attacked   = False

        # If we've gone through all heroes, switch to DM turn
        if self.hero_index == 0:
            self.phase = "dm"
            self._log("The Dungeon Master's turn begins...", "dm")
        else:
            next_hero = self._current_hero()
            if next_hero:
                self._log(f"➤ {next_hero['name']}'s turn!", "info")

    # ------------------------------------------------------------------
    # Hero actions
    # ------------------------------------------------------------------

    def action_move(self, hero_id: str, target_x: int, target_y: int) -> dict:
        if self.game_over:
            return {"success": False, "error": "Game is over."}
        if self.phase != "hero":
            return {"success": False, "error": "Not the hero phase."}

        hero = self._get_hero(hero_id)
        if not hero or not hero.get("alive"):
            return {"success": False, "error": "Hero not found or not alive."}

        current = self._current_hero()
        if not current or current["id"] != hero_id:
            return {"success": False, "error": "Not this hero's turn."}

        if self.moved:
            return {"success": False, "error": "Hero has already moved this turn."}

        # Enemies block movement; allies can be passed through but not landed on
        enemy_occ = self._occupied_enemies()
        ally_occ  = self._occupied_heroes(exclude_id=hero_id)
        reachable = bfs_reachable(self._grid(), hero["x"], hero["y"],
                                   hero["move_range"], enemy_occ, ally_occ)

        if (target_x, target_y) not in reachable:
            return {"success": False, "error": "Target tile not reachable."}

        old_x, old_y = hero["x"], hero["y"]
        hero["x"]    = target_x
        hero["y"]    = target_y
        self.moved   = True

        self._log(
            f"{hero['name']} moves from ({old_x},{old_y}) to ({target_x},{target_y}).",
            "move"
        )
        self._check_trap(hero, target_x, target_y)
        self._check_victory()
        return {"success": True}

    def action_attack(self, hero_id: str, target_x: int, target_y: int) -> dict:
        if self.game_over:
            return {"success": False, "error": "Game is over."}
        if self.phase != "hero":
            return {"success": False, "error": "Not the hero phase."}

        hero = self._get_hero(hero_id)
        if not hero or not hero.get("alive"):
            return {"success": False, "error": "Hero not found."}

        current = self._current_hero()
        if not current or current["id"] != hero_id:
            return {"success": False, "error": "Not this hero's turn."}

        if self.attacked:
            return {"success": False, "error": "Hero has already attacked this turn."}

        target_info = self._get_entity_at(target_x, target_y)
        if not target_info:
            return {"success": False, "error": "No target at that position."}

        kind, target = target_info
        if kind != "enemy":
            return {"success": False, "error": "Can only attack enemies."}

        if not in_range(hero["x"], hero["y"], target_x, target_y, hero["weapon_range"]):
            return {"success": False, "error": "Target out of weapon range."}

        result = roll_combat_dice(hero["attack_dice"], target["defend_dice"])
        self.attacked = True

        if result["hit"]:
            target["hp"] = max(0, target["hp"] - result["damage"])
            self._log(
                f"⚔ {hero['name']} attacks {target['name']}! "
                f"[{result['skulls']} skulls vs {result['shields']} shields] "
                f"→ {result['damage']} damage! (HP: {target['hp']}/{target['max_hp']})",
                "combat"
            )
            if target["hp"] <= 0:
                self._kill_entity(target)
        else:
            self._log(
                f"⚔ {hero['name']} attacks {target['name']}! "
                f"[{result['skulls']} skulls vs {result['shields']} shields] → Blocked!",
                "combat"
            )

        self._check_victory()
        return {"success": True, "combat_result": result}

    def action_cast_spell(self, hero_id: str, spell_name: str,
                           target_x: int, target_y: int) -> dict:
        if self.game_over:
            return {"success": False, "error": "Game is over."}
        if self.phase != "hero":
            return {"success": False, "error": "Not the hero phase."}

        hero = self._get_hero(hero_id)
        if not hero or not hero.get("alive"):
            return {"success": False, "error": "Hero not found."}

        current = self._current_hero()
        if not current or current["id"] != hero_id:
            return {"success": False, "error": "Not this hero's turn."}

        if self.attacked:
            return {"success": False, "error": "Already acted this turn."}

        if spell_name not in hero.get("spells", []):
            return {"success": False, "error": "Hero does not know that spell."}

        spell = SPELLS.get(spell_name)
        if not spell:
            return {"success": False, "error": "Unknown spell."}

        dist = manhattan(hero["x"], hero["y"], target_x, target_y)
        if dist > spell["range"]:
            return {"success": False, "error": "Target out of spell range."}

        self.attacked = True  # casting counts as the attack action

        if spell["effect"] == "damage":
            target_info = self._get_entity_at(target_x, target_y)
            if not target_info:
                return {"success": False, "error": "No target at that position."}
            kind, target = target_info
            if kind != "enemy":
                return {"success": False, "error": "Damage spells target enemies."}

            result = roll_combat_dice(spell["attack_dice"], target.get("defend_dice", 1))
            if result["hit"]:
                target["hp"] = max(0, target["hp"] - result["damage"])
                self._log(
                    f"✨ {hero['name']} casts {spell['name']} on {target['name']}! "
                    f"{spell['description']} → {result['damage']} damage! "
                    f"(HP: {target['hp']}/{target['max_hp']})",
                    "spell"
                )
                if target["hp"] <= 0:
                    self._kill_entity(target)
            else:
                self._log(
                    f"✨ {hero['name']} casts {spell['name']} on {target['name']}! "
                    f"{spell['description']} → Resisted!",
                    "spell"
                )
            self._check_victory()
            return {"success": True}

        elif spell["effect"] == "heal":
            target_info = self._get_entity_at(target_x, target_y)
            if target_info:
                kind, target = target_info
                if kind == "hero":
                    heal_amount   = spell.get("heal_amount", 2)
                    old_hp        = target["hp"]
                    target["hp"]  = min(target["max_hp"], target["hp"] + heal_amount)
                    actual_heal   = target["hp"] - old_hp
                    self._log(
                        f"💚 {hero['name']} casts Heal on {target['name']}! "
                        f"Restores {actual_heal} HP. (HP: {target['hp']}/{target['max_hp']})",
                        "spell"
                    )
                    return {"success": True}
            # Self-heal
            old_hp       = hero["hp"]
            hero["hp"]   = min(hero["max_hp"], hero["hp"] + spell.get("heal_amount", 2))
            actual_heal  = hero["hp"] - old_hp
            self._log(
                f"💚 {hero['name']} casts Heal on themselves! "
                f"Restores {actual_heal} HP. (HP: {hero['hp']}/{hero['max_hp']})",
                "spell"
            )
            return {"success": True}

        return {"success": False, "error": "Unknown spell effect."}

    def action_search(self, hero_id: str) -> dict:
        if self.game_over:
            return {"success": False, "error": "Game is over."}

        hero = self._get_hero(hero_id)
        if not hero or not hero.get("alive"):
            return {"success": False, "error": "Hero not found."}

        grid = self._grid()
        found = []
        for dy in range(-1, 2):
            for dx in range(-1, 2):
                nx, ny = hero["x"] + dx, hero["y"] + dy
                if 0 <= ny < len(grid) and 0 <= nx < len(grid[0]):
                    if grid[ny][nx] == 3:
                        found.append((nx, ny))

        if found:
            self._log(
                f"🔍 {hero['name']} searches and discovers a hidden trap nearby! Beware!",
                "search"
            )
        else:
            self._log(f"🔍 {hero['name']} searches the area... Nothing found.", "search")

        return {"success": True, "found": found}

    def action_end_turn(self, hero_id: str) -> dict:
        if self.game_over:
            return {"success": False, "error": "Game is over."}

        hero = self._get_hero(hero_id)
        if not hero:
            return {"success": False, "error": "Hero not found."}

        current = self._current_hero()
        if not current or current["id"] != hero_id:
            return {"success": False, "error": "Not this hero's turn."}

        self._log(f"{hero['name']} ends their turn.", "info")
        self._advance_hero_turn()
        return {"success": True}

    def get_valid_moves(self, hero_id: str) -> list:
        hero = self._get_hero(hero_id)
        if not hero or not hero.get("alive"):
            return []
        if self.moved:
            return []
        enemy_occ = self._occupied_enemies()
        ally_occ  = self._occupied_heroes(exclude_id=hero_id)
        reachable = bfs_reachable(self._grid(), hero["x"], hero["y"],
                                   hero["move_range"], enemy_occ, ally_occ)
        return [{"x": x, "y": y, "steps": s} for (x, y), s in reachable.items()]

    def get_valid_attacks(self, hero_id: str) -> list:
        hero = self._get_hero(hero_id)
        if not hero or not hero.get("alive"):
            return []
        if self.attacked:
            return []
        targets = []
        for e in self.enemies:
            if e.get("alive") and in_range(hero["x"], hero["y"], e["x"], e["y"], hero["weapon_range"]):
                targets.append({"x": e["x"], "y": e["y"], "id": e["id"]})
        return targets

    def get_valid_spell_targets(self, hero_id: str, spell_name: str) -> list:
        hero = self._get_hero(hero_id)
        if not hero or not hero.get("alive"):
            return []
        spell = SPELLS.get(spell_name)
        if not spell:
            return []
        targets = []
        if spell["effect"] == "damage":
            for e in self.enemies:
                if e.get("alive") and manhattan(hero["x"], hero["y"], e["x"], e["y"]) <= spell["range"]:
                    targets.append({"x": e["x"], "y": e["y"], "id": e["id"], "type": "enemy"})
        elif spell["effect"] == "heal":
            for h in self.heroes:
                if h.get("alive") and manhattan(hero["x"], hero["y"], h["x"], h["y"]) <= spell["range"]:
                    targets.append({"x": h["x"], "y": h["y"], "id": h["id"], "type": "hero"})
        return targets

    # ------------------------------------------------------------------
    # DM (AI) turn
    # ------------------------------------------------------------------

    def dm_turn(self) -> list:
        """Run all enemy AI actions. Returns list of action log entries."""
        if self.game_over:
            return []
        if self.phase != "dm":
            # Force DM phase if called out of order
            self.phase = "dm"

        actions = []
        alive_heroes  = [h for h in self.heroes  if h.get("alive")]
        alive_enemies = [e for e in self.enemies if e.get("alive")]

        if not alive_heroes or not alive_enemies:
            self._end_dm_turn()
            return actions

        for enemy in alive_enemies:
            # Find nearest hero
            nearest = min(alive_heroes, key=lambda h: manhattan(enemy["x"], enemy["y"], h["x"], h["y"]))
            dist    = manhattan(enemy["x"], enemy["y"], nearest["x"], nearest["y"])

            # Attack if in range
            if dist <= enemy.get("weapon_range", 1):
                result = roll_combat_dice(enemy["attack_dice"], nearest["defend_dice"])
                if result["hit"]:
                    nearest["hp"] = max(0, nearest["hp"] - result["damage"])
                    msg = (
                        f"👹 {enemy['name']} attacks {nearest['name']}! "
                        f"[{result['skulls']} skulls vs {result['shields']} shields] "
                        f"→ {result['damage']} damage! (HP: {nearest['hp']}/{nearest['max_hp']})"
                    )
                    self._log(msg, "dm_attack")
                    actions.append({
                        "type":       "attack",
                        "enemy_id":   enemy["id"],
                        "target_id":  nearest["id"],
                        "result":     result,
                    })
                    if nearest["hp"] <= 0:
                        self._kill_entity(nearest)
                        alive_heroes = [h for h in self.heroes if h.get("alive")]
                else:
                    msg = (
                        f"👹 {enemy['name']} attacks {nearest['name']}! "
                        f"[{result['skulls']} skulls vs {result['shields']} shields] → Blocked!"
                    )
                    self._log(msg, "dm_attack")
                    actions.append({
                        "type":       "attack",
                        "enemy_id":   enemy["id"],
                        "target_id":  nearest["id"],
                        "result":     result,
                    })
            else:
                # Move toward nearest hero – use full occupied set for enemies
                occupied = self._occupied(exclude_id=enemy["id"])
                # Find adjacent tile of nearest hero as goal
                best_goal = None
                best_dist = dist

                # Try to get adjacent to hero
                for gx, gy in self._adjacent_tiles(nearest["x"], nearest["y"]):
                    if (gx, gy) not in occupied:
                        d = manhattan(enemy["x"], enemy["y"], gx, gy)
                        if d < best_dist:
                            best_dist = d
                            best_goal = (gx, gy)

                if best_goal is None:
                    best_goal = (nearest["x"], nearest["y"])

                path = bfs_path(self._grid(), enemy["x"], enemy["y"],
                                best_goal[0], best_goal[1], occupied)

                if path:
                    steps = min(len(path), enemy.get("move_range", 6))
                    old_x, old_y = enemy["x"], enemy["y"]
                    enemy["x"], enemy["y"] = path[steps - 1]
                    msg = (
                        f"👹 {enemy['name']} moves from ({old_x},{old_y}) "
                        f"to ({enemy['x']},{enemy['y']})."
                    )
                    self._log(msg, "dm_move")
                    actions.append({
                        "type":     "move",
                        "enemy_id": enemy["id"],
                        "from_x":   old_x,
                        "from_y":   old_y,
                        "to_x":     enemy["x"],
                        "to_y":     enemy["y"],
                        "path":     path[:steps],
                    })
                    self._check_trap(enemy, enemy["x"], enemy["y"])

            if self._check_victory():
                break

        self._end_dm_turn()
        return actions

    def _adjacent_tiles(self, x, y):
        grid = self._grid()
        rows, cols = len(grid), len(grid[0])
        for dx, dy in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            nx, ny = x + dx, y + dy
            if 0 <= ny < rows and 0 <= nx < cols and grid[ny][nx] != 1:
                yield nx, ny

    def _end_dm_turn(self):
        self.phase      = "hero"
        self.hero_index = 0
        self.moved      = False
        self.attacked   = False
        self.round_number += 1

        # Reset per-turn flags for heroes
        for h in self.heroes:
            h["has_moved"]    = False
            h["has_attacked"] = False

        alive = [h for h in self.heroes if h.get("alive")]
        if alive and not self.game_over:
            self._log(
                f"━━ Round {self.round_number} ━━  {alive[0]['name']}'s turn!",
                "info"
            )

    # ------------------------------------------------------------------
    # Serialisation
    # ------------------------------------------------------------------

    def to_dict(self) -> dict:
        alive_heroes  = [h for h in self.heroes  if h.get("alive")]
        current_hero  = self._current_hero()
        alive_enemies = [e for e in self.enemies if e.get("alive")]

        return {
            "heroes":          self.heroes,
            "enemies":         self.enemies,
            "map":             self.map_data,
            "quest":           self.quest,
            "phase":           self.phase,
            "hero_index":      self.hero_index,
            "moved":           self.moved,
            "attacked":        self.attacked,
            "game_over":       self.game_over,
            "victory":         self.victory,
            "round_number":    self.round_number,
            "current_hero_id": current_hero["id"] if current_hero else None,
            "alive_heroes":    len(alive_heroes),
            "alive_enemies":   len(alive_enemies),
            "log":             self.log[-50:],  # last 50 entries
        }

    def save(self):
        with open(SAVE_FILE, "w") as f:
            json.dump(self.to_dict(), f, indent=2)

    def load(self):
        if not os.path.exists(SAVE_FILE):
            raise FileNotFoundError("No save file found.")
        with open(SAVE_FILE) as f:
            data = json.load(f)
        self.heroes       = data["heroes"]
        self.enemies      = data["enemies"]
        self.map_data     = data["map"]
        self.quest        = data["quest"]
        self.phase        = data.get("phase", "hero")
        self.hero_index   = data.get("hero_index", 0)
        self.moved        = data.get("moved", False)
        self.attacked     = data.get("attacked", False)
        self.game_over    = data.get("game_over", False)
        self.victory      = data.get("victory", False)
        self.round_number = data.get("round_number", 1)
        self.log          = data.get("log", [])
