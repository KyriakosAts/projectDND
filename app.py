"""
app.py - Hero Quest: Digital Edition
Flask application serving the game API and frontend.
"""

from flask import Flask, jsonify, request, render_template
from game_logic import GameState
import traceback

app = Flask(__name__)

# Single shared game state (one concurrent session)
state = GameState()
state.new_game()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ok(extra_log=None):
    """Return a successful JSON response with current state."""
    d = state.to_dict()
    if extra_log:
        d["log"] = state.log[-50:]
    return jsonify({"success": True, "state": d, "log": state.log[-50:]})


def _err(message: str, code: int = 400):
    return jsonify({"success": False, "error": message}), code


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/state", methods=["GET"])
def api_state():
    return _ok()


@app.route("/api/new_game", methods=["POST"])
def api_new_game():
    state.new_game()
    return _ok()


@app.route("/api/action", methods=["POST"])
def api_action():
    try:
        body        = request.get_json(force=True) or {}
        action_type = body.get("type") or body.get("action_type", "")
        hero_id     = body.get("hero_id", "")
        target_x    = int(body.get("target_x", 0))
        target_y    = int(body.get("target_y", 0))
        spell_name  = body.get("spell_name", "")

        if action_type == "move":
            result = state.action_move(hero_id, target_x, target_y)
        elif action_type == "attack":
            result = state.action_attack(hero_id, target_x, target_y)
        elif action_type == "cast_spell":
            result = state.action_cast_spell(hero_id, spell_name, target_x, target_y)
        elif action_type == "search":
            result = state.action_search(hero_id)
        elif action_type == "end_turn":
            result = state.action_end_turn(hero_id)
        elif action_type == "get_valid_moves":
            moves = state.get_valid_moves(hero_id)
            return jsonify({"success": True, "moves": moves, "state": state.to_dict()})
        elif action_type == "get_valid_attacks":
            attacks = state.get_valid_attacks(hero_id)
            return jsonify({"success": True, "attacks": attacks, "state": state.to_dict()})
        elif action_type == "get_valid_spell_targets":
            targets = state.get_valid_spell_targets(hero_id, spell_name)
            return jsonify({"success": True, "targets": targets, "state": state.to_dict()})
        else:
            return _err(f"Unknown action type: {action_type}")

        if not result.get("success"):
            return jsonify({"success": False, "error": result.get("error", "Unknown error"),
                            "state": state.to_dict(), "log": state.log[-50:]}), 400

        return _ok()

    except Exception as e:
        traceback.print_exc()
        return _err(str(e), 500)


@app.route("/api/dm_turn", methods=["POST"])
def api_dm_turn():
    try:
        actions = state.dm_turn()
        d = state.to_dict()
        return jsonify({"success": True, "state": d, "log": state.log[-50:], "actions": actions})
    except Exception as e:
        traceback.print_exc()
        return _err(str(e), 500)


@app.route("/api/save", methods=["POST"])
def api_save():
    try:
        state.save()
        return jsonify({"success": True, "message": "Game saved."})
    except Exception as e:
        return _err(str(e), 500)


@app.route("/api/load", methods=["POST"])
def api_load():
    try:
        state.load()
        return _ok()
    except FileNotFoundError as e:
        return _err(str(e), 404)
    except Exception as e:
        traceback.print_exc()
        return _err(str(e), 500)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
