/**
 * engine.js - Hero Quest: Digital Edition
 * Complete Phaser 3 game engine with all gameplay logic, rendering, and animations.
 */

"use strict";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TILE        = 48;          // px per tile
const MAP_COLS    = 12;
const MAP_ROWS    = 12;
const CANVAS_W    = TILE * MAP_COLS;   // 576
const CANVAS_H    = TILE * MAP_ROWS;   // 576

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function tileToPixel(tx, ty) {
  return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
}

function pixelToTile(px, py) {
  return { tx: Math.floor(px / TILE), ty: Math.floor(py / TILE) };
}

// ---------------------------------------------------------------------------
// BootScene – create textures & show loading screen
// ---------------------------------------------------------------------------

class BootScene extends Phaser.Scene {
  constructor() { super({ key: "BootScene" }); }

  preload() {
    // Show a simple loading bar
    const w = CANVAS_W, h = CANVAS_H;
    const bar = this.add.graphics();
    bar.fillStyle(0x1a0a00, 1);
    bar.fillRect(0, 0, w, h);
    bar.fillStyle(0x8b6914, 1);
    bar.fillRect(w / 4, h / 2 - 10, w / 2, 20);
    const fill = this.add.graphics();
    const text = this.add.text(w / 2, h / 2 - 30, "Loading Witchwood...", {
      fontSize: "16px", fill: "#c8960c", fontFamily: "Palatino, serif"
    }).setOrigin(0.5);

    this.load.on("progress", (v) => {
      fill.clear();
      fill.fillStyle(0xc8960c, 1);
      fill.fillRect(w / 4 + 2, h / 2 - 8, (w / 2 - 4) * v, 16);
    });
  }

  create() {
    // Build all procedural textures from assets.js
    window.GameAssets.createAll(this);
    this.scene.start("GameScene");
  }
}

// ---------------------------------------------------------------------------
// GameScene – main gameplay
// ---------------------------------------------------------------------------

class GameScene extends Phaser.Scene {
  constructor() { super({ key: "GameScene" }); }

  // -------------------------------------------------------------------------
  // Phaser lifecycle
  // -------------------------------------------------------------------------

  create() {
    // State cache
    this.gameState   = null;
    this.tileLayer   = null;
    this.heroSprites = {};   // hero_id → { sprite, hpBar, hpBg }
    this.enemySprites= {};   // enemy_id → { sprite, hpBar, hpBg }
    this.highlights  = [];   // array of Phaser Image objects
    this.deadMarkers = {};   // id → sprite

    // Interaction mode
    this.mode        = "idle";   // "idle" | "move" | "attack" | "spell"
    this.selectedSpell = null;
    this.pendingMoves  = [];     // valid move tiles [{x,y,steps}]
    this.pendingAttacks= [];     // valid attack targets [{x,y,id}]
    this.pendingSpellTargets = [];

    // Layers (z-order)
    this.layerTiles  = this.add.container(0, 0);
    this.layerOverlay= this.add.container(0, 0);
    this.layerChars  = this.add.container(0, 0);
    this.layerUI     = this.add.container(0, 0);

    // Input
    this.input.on("pointerdown", this._onCanvasClick, this);

    // Fetch initial state
    this._fetchState();
  }

  // -------------------------------------------------------------------------
  // State management
  // -------------------------------------------------------------------------

  _fetchState() {
    fetch("/api/state")
      .then(r => r.json())
      .then(data => {
        this._applyState(data.state, data.log);
      })
      .catch(err => {
        console.error("Failed to fetch state:", err);
        this._addLog("⚠ Could not connect to server.", "info");
      });
  }

  _applyState(state, log) {
    this.gameState = state;

    // Render map on first load (tiles don't change)
    if (this.layerTiles.list.length === 0) {
      this._renderMap(state.map);
    }

    // Sync hero sprites
    state.heroes.forEach(hero => this._syncHeroSprite(hero));

    // Sync enemy sprites
    state.enemies.forEach(enemy => this._syncEnemySprite(enemy));

    // Update UI panels
    this._updateHeroCards(state);
    this._updateTurnBanner(state);

    // Clear any stale highlights
    this._clearHighlights();
    this.mode         = "idle";
    this.selectedSpell= null;
    this._updateActionButtons(state);

    // Append log entries
    if (log && log.length) {
      const existingCount = parseInt(this._logPanel().dataset.count || "0");
      const newEntries    = log.slice(existingCount);
      newEntries.forEach(entry => this._addLog(entry.message, entry.category));
      this._logPanel().dataset.count = log.length;
    }

    // Victory / defeat overlay
    if (state.game_over) {
      this._showOutcome(state.victory, state);
    }
  }

  // -------------------------------------------------------------------------
  // Map rendering
  // -------------------------------------------------------------------------

  _renderMap(mapData) {
    const tiles = mapData.tiles;
    const keyMap = { 0: "tile_floor", 1: "tile_wall", 2: "tile_door", 3: "tile_trap" };

    for (let row = 0; row < tiles.length; row++) {
      for (let col = 0; col < tiles[row].length; col++) {
        const tileType = tiles[row][col];
        const key      = keyMap[tileType] || "tile_floor";
        const px       = col * TILE;
        const py       = row * TILE;
        const img      = this.add.image(px, py, key).setOrigin(0, 0);
        this.layerTiles.add(img);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Character sprites
  // -------------------------------------------------------------------------

  _syncHeroSprite(hero) {
    const pos  = tileToPixel(hero.x, hero.y);
    const key  = window.GameAssets.heroKey(hero);

    if (!this.heroSprites[hero.id]) {
      // Create new sprite
      const sprite = this.add.image(pos.x, pos.y, key).setDepth(2);
      const hpBg   = this.add.rectangle(pos.x, pos.y - TILE / 2 + 4, TILE - 8, 5, 0x000000).setDepth(3);
      const hpBar  = this.add.rectangle(pos.x - (TILE - 10) / 2, pos.y - TILE / 2 + 4,
                                         TILE - 10, 4, 0x33aa44)
                       .setOrigin(0, 0.5).setDepth(3);

      this.layerChars.add(sprite);
      this.layerUI.add(hpBg);
      this.layerUI.add(hpBar);

      this.heroSprites[hero.id] = { sprite, hpBg, hpBar };
    }

    const { sprite, hpBg, hpBar } = this.heroSprites[hero.id];

    if (!hero.alive) {
      sprite.setAlpha(0.25);
      hpBg.setVisible(false);
      hpBar.setVisible(false);
      this._ensureDeadMarker(hero.id, pos.x, pos.y);
    } else {
      sprite.setAlpha(1);
      sprite.setPosition(pos.x, pos.y);
      hpBg.setPosition(pos.x, pos.y - TILE / 2 + 4);
      this._updateHPBar(hpBar, pos.x - (TILE - 10) / 2, pos.y - TILE / 2 + 4,
                        hero.hp, hero.max_hp);
    }
  }

  _syncEnemySprite(enemy) {
    const pos = tileToPixel(enemy.x, enemy.y);
    const key = window.GameAssets.enemyKey(enemy);

    if (!this.enemySprites[enemy.id]) {
      const sprite = this.add.image(pos.x, pos.y, key).setDepth(2);
      const hpBg   = this.add.rectangle(pos.x, pos.y - TILE / 2 + 4, TILE - 8, 5, 0x000000).setDepth(3);
      const hpBar  = this.add.rectangle(pos.x - (TILE - 10) / 2, pos.y - TILE / 2 + 4,
                                         TILE - 10, 4, 0xcc3333)
                       .setOrigin(0, 0.5).setDepth(3);

      this.layerChars.add(sprite);
      this.layerUI.add(hpBg);
      this.layerUI.add(hpBar);

      this.enemySprites[enemy.id] = { sprite, hpBg, hpBar };
    }

    const { sprite, hpBg, hpBar } = this.enemySprites[enemy.id];

    if (!enemy.alive) {
      this.tweens.add({ targets: sprite, alpha: 0, duration: 400, ease: "Power2" });
      hpBg.setVisible(false);
      hpBar.setVisible(false);
      this._ensureDeadMarker(enemy.id, pos.x, pos.y);
    } else {
      sprite.setAlpha(1);
      sprite.setPosition(pos.x, pos.y);
      hpBg.setPosition(pos.x, pos.y - TILE / 2 + 4);
      this._updateHPBar(hpBar, pos.x - (TILE - 10) / 2, pos.y - TILE / 2 + 4,
                        enemy.hp, enemy.max_hp);
    }
  }

  _updateHPBar(hpBar, baseX, baseY, hp, maxHp) {
    const pct   = Math.max(0, hp / maxHp);
    const maxW  = TILE - 10;
    hpBar.setPosition(baseX, baseY);
    hpBar.width = Math.max(1, maxW * pct);
    const color = pct > 0.6 ? 0x33aa44 : pct > 0.3 ? 0xccaa22 : 0xcc3333;
    hpBar.setFillStyle(color);
    hpBar.setVisible(hp > 0);
  }

  _ensureDeadMarker(id, px, py) {
    if (this.deadMarkers[id]) return;
    const m = this.add.image(px, py, "dead_marker").setDepth(4).setAlpha(0.8);
    this.layerUI.add(m);
    this.deadMarkers[id] = m;
  }

  // -------------------------------------------------------------------------
  // Highlights
  // -------------------------------------------------------------------------

  _clearHighlights() {
    this.highlights.forEach(h => h.destroy());
    this.highlights = [];
  }

  _showMoveHighlights(tiles) {
    this._clearHighlights();
    tiles.forEach(({ x, y }) => {
      const px = x * TILE, py = y * TILE;
      const img = this.add.image(px, py, "highlight_move").setOrigin(0, 0).setDepth(1);
      this.layerOverlay.add(img);
      this.highlights.push(img);
    });
  }

  _showAttackHighlights(targets) {
    this._clearHighlights();
    targets.forEach(({ x, y }) => {
      const px = x * TILE, py = y * TILE;
      const img = this.add.image(px, py, "highlight_attack").setOrigin(0, 0).setDepth(1);
      this.layerOverlay.add(img);
      this.highlights.push(img);
    });
  }

  _showSpellHighlights(targets) {
    this._clearHighlights();
    targets.forEach(({ x, y }) => {
      const px = x * TILE, py = y * TILE;
      const img = this.add.image(px, py, "highlight_spell").setOrigin(0, 0).setDepth(1);
      this.layerOverlay.add(img);
      this.highlights.push(img);
    });
  }

  // -------------------------------------------------------------------------
  // Canvas click handling
  // -------------------------------------------------------------------------

  _onCanvasClick(pointer) {
    const { tx, ty } = pixelToTile(pointer.x, pointer.y);

    if (this.mode === "move") {
      this._handleMoveClick(tx, ty);
    } else if (this.mode === "attack") {
      this._handleAttackClick(tx, ty);
    } else if (this.mode === "spell") {
      this._handleSpellClick(tx, ty);
    }
  }

  _handleMoveClick(tx, ty) {
    const target = this.pendingMoves.find(m => m.x === tx && m.y === ty);
    if (!target) return;

    const heroId = this.gameState.current_hero_id;
    this._clearHighlights();
    this.mode = "idle";

    this._postAction({ type: "move", hero_id: heroId, target_x: tx, target_y: ty })
      .then(data => {
        if (data.success) {
          const hero   = data.state.heroes.find(h => h.id === heroId);
          const entry  = this.heroSprites[heroId];
          if (hero && entry) {
            const pos = tileToPixel(hero.x, hero.y);
            this.tweens.add({
              targets: [entry.sprite, entry.hpBg, entry.hpBar],
              x: pos.x, y: pos.y,
              duration: 280, ease: "Power2",
              onComplete: () => this._applyState(data.state, data.log),
            });
            // Shift hpBar origin correction
            this.tweens.add({
              targets: entry.hpBar,
              x: pos.x - (TILE - 10) / 2,
              duration: 280, ease: "Power2",
            });
          } else {
            this._applyState(data.state, data.log);
          }
        } else {
          this._addLog("⚠ " + (data.error || "Move failed."), "info");
        }
      });
  }

  _handleAttackClick(tx, ty) {
    const target = this.pendingAttacks.find(a => a.x === tx && a.y === ty);
    if (!target) return;

    const heroId = this.gameState.current_hero_id;
    this._clearHighlights();
    this.mode = "idle";

    this._postAction({ type: "attack", hero_id: heroId, target_x: tx, target_y: ty })
      .then(data => {
        if (data.success) {
          this._animateAttack(tx, ty, () => this._applyState(data.state, data.log));
        } else {
          this._addLog("⚠ " + (data.error || "Attack failed."), "info");
        }
      });
  }

  _handleSpellClick(tx, ty) {
    const target = this.pendingSpellTargets.find(t => t.x === tx && t.y === ty);
    if (!target) return;

    const heroId = this.gameState.current_hero_id;
    this._clearHighlights();
    this.mode = "idle";

    this._postAction({
      type: "cast_spell", hero_id: heroId,
      spell_name: this.selectedSpell,
      target_x: tx, target_y: ty,
    }).then(data => {
      if (data.success) {
        this._animateSpell(tx, ty, this.selectedSpell,
          () => this._applyState(data.state, data.log));
        this.selectedSpell = null;
      } else {
        this._addLog("⚠ " + (data.error || "Spell failed."), "info");
      }
    });
  }

  // -------------------------------------------------------------------------
  // Animations
  // -------------------------------------------------------------------------

  _animateAttack(tx, ty, callback) {
    const pos   = tileToPixel(tx, ty);
    const flash = this.add.image(pos.x, pos.y, "hit_flash").setDepth(5).setAlpha(0);
    this.layerUI.add(flash);

    this.tweens.add({
      targets: flash,
      alpha: { from: 0.9, to: 0 },
      scaleX: { from: 1, to: 1.4 },
      scaleY: { from: 1, to: 1.4 },
      duration: 380,
      ease: "Power2",
      onComplete: () => {
        flash.destroy();
        if (callback) callback();
      },
    });

    // Camera shake
    this.cameras.main.shake(180, 0.004);
  }

  _animateSpell(tx, ty, spellName, callback) {
    const pos   = tileToPixel(tx, ty);
    const color = spellName === "heal" ? 0x33ff66 :
                  spellName === "firebolt" ? 0xff6600 : 0x8888ff;

    // Burst particles (manual circles)
    for (let i = 0; i < 8; i++) {
      const angle  = (Math.PI * 2 / 8) * i;
      const circle = this.add.circle(pos.x, pos.y, 5, color, 0.9).setDepth(6);
      this.layerUI.add(circle);
      const dist = TILE * 0.7;
      this.tweens.add({
        targets: circle,
        x: pos.x + Math.cos(angle) * dist,
        y: pos.y + Math.sin(angle) * dist,
        alpha: 0,
        scaleX: 0.2,
        scaleY: 0.2,
        duration: 500,
        ease: "Power2",
        onComplete: () => circle.destroy(),
      });
    }

    this.time.delayedCall(520, callback);
  }

  _animateEnemyMove(sprite, hpBg, hpBar, toTx, toTy, callback) {
    const pos = tileToPixel(toTx, toTy);
    this.tweens.add({
      targets: sprite,
      x: pos.x, y: pos.y,
      duration: 300, ease: "Power2",
    });
    this.tweens.add({
      targets: hpBg,
      x: pos.x, y: pos.y - TILE / 2 + 4,
      duration: 300, ease: "Power2",
    });
    this.tweens.add({
      targets: hpBar,
      x: pos.x - (TILE - 10) / 2,
      y: pos.y - TILE / 2 + 4,
      duration: 300, ease: "Power2",
      onComplete: callback,
    });
  }

  // -------------------------------------------------------------------------
  // DM Turn orchestration
  // -------------------------------------------------------------------------

  _runDmTurn() {
    this._disableAllButtons();
    this._addLog("⚙ Dungeon Master's turn...", "info");

    fetch("/api/dm_turn", { method: "POST" })
      .then(r => r.json())
      .then(data => {
        if (!data.success) {
          this._addLog("⚠ DM turn error.", "info");
          this._applyState(data.state || this.gameState, data.log);
          return;
        }
        this._animateDmActions(data.actions || [], data.state, data.log);
      })
      .catch(err => {
        console.error("DM turn error:", err);
        this._fetchState();
      });
  }

  _animateDmActions(actions, finalState, finalLog) {
    if (!actions || actions.length === 0) {
      this._applyState(finalState, finalLog);
      return;
    }

    let delay = 0;
    actions.forEach(action => {
      if (action.type === "move") {
        const entry = this.enemySprites[action.enemy_id];
        if (entry) {
          this.time.delayedCall(delay, () => {
            this._animateEnemyMove(
              entry.sprite, entry.hpBg, entry.hpBar,
              action.to_x, action.to_y, null
            );
          });
          delay += 380;
        }
      } else if (action.type === "attack") {
        this.time.delayedCall(delay, () => {
          // Find target position
          const target = finalState.heroes.find(h => h.id === action.target_id)
                      || finalState.enemies.find(e => e.id === action.target_id);
          if (target) {
            this._animateAttack(target.x, target.y, null);
          }
        });
        delay += 420;
      }
    });

    // Apply final state after all animations
    this.time.delayedCall(delay + 200, () => {
      this._applyState(finalState, finalLog);
    });
  }

  // -------------------------------------------------------------------------
  // API helpers
  // -------------------------------------------------------------------------

  _postAction(body) {
    return fetch("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(r => r.json());
  }

  _postActionForHighlights(actionType, heroId, spellName) {
    const body = { type: actionType, hero_id: heroId };
    if (spellName) body.spell_name = spellName;
    return this._postAction(body);
  }

  // -------------------------------------------------------------------------
  // Button actions (called from HTML)
  // -------------------------------------------------------------------------

  onMoveButton() {
    if (!this.gameState) return;
    const heroId = this.gameState.current_hero_id;
    if (!heroId || this.gameState.phase !== "hero") return;

    if (this.mode === "move") {
      this._clearHighlights();
      this.mode = "idle";
      this._setButtonActive(null);
      return;
    }

    this._postAction({ type: "get_valid_moves", hero_id: heroId })
      .then(data => {
        if (data.moves && data.moves.length > 0) {
          this.pendingMoves = data.moves;
          this.mode = "move";
          this._showMoveHighlights(data.moves);
          this._setButtonActive("btn-move");
          this._addLog("Click a green tile to move.", "info");
        } else {
          this._addLog("No valid moves available.", "info");
        }
      });
  }

  onAttackButton() {
    if (!this.gameState) return;
    const heroId = this.gameState.current_hero_id;
    if (!heroId || this.gameState.phase !== "hero") return;

    if (this.mode === "attack") {
      this._clearHighlights();
      this.mode = "idle";
      this._setButtonActive(null);
      return;
    }

    this._postAction({ type: "get_valid_attacks", hero_id: heroId })
      .then(data => {
        if (data.attacks && data.attacks.length > 0) {
          this.pendingAttacks = data.attacks;
          this.mode = "attack";
          this._showAttackHighlights(data.attacks);
          this._setButtonActive("btn-attack");
          this._addLog("Click a red tile to attack.", "info");
        } else {
          this._addLog("No enemies in weapon range.", "info");
        }
      });
  }

  onSpellButton(spellName) {
    if (!this.gameState) return;
    const heroId = this.gameState.current_hero_id;
    if (!heroId || this.gameState.phase !== "hero") return;

    if (this.mode === "spell" && this.selectedSpell === spellName) {
      this._clearHighlights();
      this.mode = "idle";
      this.selectedSpell = null;
      this._setButtonActive(null);
      return;
    }

    this._postAction({ type: "get_valid_spell_targets", hero_id: heroId, spell_name: spellName })
      .then(data => {
        if (data.targets && data.targets.length > 0) {
          this.pendingSpellTargets = data.targets;
          this.mode          = "spell";
          this.selectedSpell = spellName;
          this._showSpellHighlights(data.targets);
          this._setButtonActive("btn-spell");
          this._addLog(`Click a blue tile to cast ${spellName.replace("_", " ")}.`, "spell");
        } else {
          this._addLog("No valid targets for that spell.", "info");
        }
      });
  }

  onSearchButton() {
    if (!this.gameState) return;
    const heroId = this.gameState.current_hero_id;
    if (!heroId) return;

    this._postAction({ type: "search", hero_id: heroId })
      .then(data => this._applyState(data.state, data.log));
  }

  onEndTurnButton() {
    if (!this.gameState) return;
    const heroId = this.gameState.current_hero_id;
    if (!heroId) return;

    this._clearHighlights();
    this.mode = "idle";

    this._postAction({ type: "end_turn", hero_id: heroId })
      .then(data => {
        if (data.success) {
          this._applyState(data.state, data.log);
          // Check if we should trigger DM turn
          if (data.state.phase === "dm" && !data.state.game_over) {
            this.time.delayedCall(600, () => this._runDmTurn());
          }
        }
      });
  }

  onNewGameButton() {
    fetch("/api/new_game", { method: "POST" })
      .then(r => r.json())
      .then(data => {
        // Reset all sprite caches
        Object.values(this.heroSprites).forEach(e => {
          e.sprite.destroy(); e.hpBg.destroy(); e.hpBar.destroy();
        });
        Object.values(this.enemySprites).forEach(e => {
          e.sprite.destroy(); e.hpBg.destroy(); e.hpBar.destroy();
        });
        Object.values(this.deadMarkers).forEach(m => m.destroy());
        this.heroSprites  = {};
        this.enemySprites = {};
        this.deadMarkers  = {};
        this.layerChars.removeAll(true);
        this.layerUI.removeAll(true);

        // Reset log counter
        const logPanel = this._logPanel();
        logPanel.innerHTML = "";
        logPanel.dataset.count = "0";

        // Hide outcome overlay
        const overlay = document.getElementById("outcome-overlay");
        if (overlay) { overlay.classList.remove("show"); }

        this._applyState(data.state, data.log);
      });
  }

  onSaveButton() {
    fetch("/api/save", { method: "POST" })
      .then(r => r.json())
      .then(d => this._addLog(d.message || "Game saved.", "info"));
  }

  onLoadButton() {
    fetch("/api/load", { method: "POST" })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          // Rebuild sprite caches
          this.onNewGameButton(); // clears sprites
          setTimeout(() => this._fetchState(), 50);
        } else {
          this._addLog("⚠ " + (data.error || "Load failed."), "info");
        }
      });
  }

  // -------------------------------------------------------------------------
  // UI helpers
  // -------------------------------------------------------------------------

  _logPanel() {
    return document.getElementById("dungeon-log");
  }

  _addLog(message, category) {
    const panel = this._logPanel();
    if (!panel) return;

    const div = document.createElement("div");
    div.className = `log-entry log-${category || "info"}`;
    div.textContent = message;
    panel.appendChild(div);

    // Keep max 200 entries visible
    while (panel.children.length > 200) {
      panel.removeChild(panel.firstChild);
    }
    panel.scrollTop = panel.scrollHeight;
  }

  _updateTurnBanner(state) {
    const banner = document.getElementById("turn-banner");
    if (!banner) return;
    const nameEl = banner.querySelector(".turn-name");
    const infoEl = banner.querySelector(".turn-info");

    if (state.phase === "dm") {
      if (nameEl) nameEl.textContent = "⚔ Dungeon Master's Turn";
      if (infoEl) infoEl.textContent = "Enemies are moving...";
    } else if (state.current_hero_id) {
      const hero = state.heroes.find(h => h.id === state.current_hero_id);
      if (nameEl) nameEl.textContent = hero ? `🛡 ${hero.name}'s Turn` : "Hero Turn";
      const moved    = state.moved    ? "✓" : "○";
      const attacked = state.attacked ? "✓" : "○";
      if (infoEl) infoEl.textContent = `Move ${moved}  Attack ${attacked}  Round ${state.round_number}`;
    }
  }

  _updateHeroCards(state) {
    const container = document.getElementById("hero-cards");
    if (!container) return;

    container.innerHTML = "";
    state.heroes.forEach(hero => {
      const pct     = Math.max(0, hero.hp / hero.max_hp);
      const hpColor = pct > 0.6 ? "#33aa44" : pct > 0.3 ? "#ccaa22" : "#cc3333";
      const isActive= hero.id === state.current_hero_id && state.phase === "hero";
      const fainted = !hero.alive;

      const card = document.createElement("div");
      card.className = `hero-card${isActive ? " active-turn" : ""}${fainted ? " fainted" : ""}`;
      card.innerHTML = `
        <div class="hero-name">
          <span class="hero-dot" style="background:${hero.color}"></span>
          ${hero.name}
        </div>
        <div class="hero-class">${hero.class} · ATK ${hero.attack_dice}d · DEF ${hero.defend_dice}d</div>
        <div class="hp-bar-outer">
          <div class="hp-bar-inner" style="width:${Math.round(pct*100)}%;background:${hpColor}"></div>
        </div>
        <div class="hp-text">HP ${hero.hp} / ${hero.max_hp}${fainted ? " · <em>Fainted</em>" : ""}</div>
        <div class="turn-arrow">▶</div>
      `;
      container.appendChild(card);
    });
  }

  _updateActionButtons(state) {
    const isDm      = state.phase === "dm";
    const isGameOver= state.game_over;
    const hero      = state.heroes.find(h => h.id === state.current_hero_id);
    const hasSpells = hero && hero.spells && hero.spells.length > 0;
    const canMove   = !isDm && !isGameOver && !state.moved;
    const canAct    = !isDm && !isGameOver && !state.attacked;

    this._setButtonEnabled("btn-move",     canMove);
    this._setButtonEnabled("btn-attack",   canAct);
    this._setButtonEnabled("btn-spell",    canAct && hasSpells);
    this._setButtonEnabled("btn-search",   !isDm && !isGameOver);
    this._setButtonEnabled("btn-end-turn", !isDm && !isGameOver);

    // Spell sub-buttons
    const spellSel = document.getElementById("spell-selector");
    if (spellSel) {
      spellSel.innerHTML = "";
      if (hero && hero.spells && hero.spells.length > 0) {
        hero.spells.forEach(spell => {
          const btn = document.createElement("button");
          btn.className = "btn-fantasy btn-spell";
          btn.textContent = spell.replace("_", " ").replace(/\b\w/g, c => c.toUpperCase());
          btn.disabled    = !canAct;
          btn.onclick     = () => window.game.scene.getScene("GameScene").onSpellButton(spell);
          spellSel.appendChild(btn);
        });
        spellSel.classList.add("show");
      } else {
        spellSel.classList.remove("show");
      }
    }
  }

  _disableAllButtons() {
    ["btn-move","btn-attack","btn-spell","btn-search","btn-end-turn"].forEach(id => {
      this._setButtonEnabled(id, false);
    });
  }

  _setButtonEnabled(id, enabled) {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = !enabled;
  }

  _setButtonActive(activeId) {
    ["btn-move","btn-attack","btn-spell"].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.classList.toggle("active", id === activeId);
    });
  }

  _showOutcome(victory, state) {
    const overlay = document.getElementById("outcome-overlay");
    if (!overlay) return;
    const title   = overlay.querySelector("h2");
    const desc    = overlay.querySelector("p");
    if (title) title.textContent = victory ? "⚔ Victory! ⚔" : "💀 Defeat... 💀";
    if (desc) {
      const quest = state.quest && state.quest.quests
        ? state.quest.quests[state.quest.current_quest]
        : null;
      desc.textContent = quest
        ? (victory ? quest.complete_text : "All heroes have fallen. The dungeon claims another band...")
        : "";
    }
    overlay.classList.add("show");
  }
}

// ---------------------------------------------------------------------------
// Phaser game configuration & startup
// ---------------------------------------------------------------------------

const phaserConfig = {
  type: Phaser.AUTO,
  width:  CANVAS_W,
  height: CANVAS_H,
  parent: "game-container",
  backgroundColor: "#0d0500",
  scene: [BootScene, GameScene],
  audio: { noAudio: true },
};

// Start Phaser after DOM is ready
window.addEventListener("DOMContentLoaded", () => {
  window.game = new Phaser.Game(phaserConfig);

  // Wire up top-level buttons to the game scene
  const getScene = () => window.game.scene.getScene("GameScene");

  document.getElementById("btn-move")    ?.addEventListener("click", () => getScene()?.onMoveButton());
  document.getElementById("btn-attack")  ?.addEventListener("click", () => getScene()?.onAttackButton());
  document.getElementById("btn-spell")   ?.addEventListener("click", () => {
    const sel = document.getElementById("spell-selector");
    sel?.classList.toggle("show");
  });
  document.getElementById("btn-search")  ?.addEventListener("click", () => getScene()?.onSearchButton());
  document.getElementById("btn-end-turn")?.addEventListener("click", () => getScene()?.onEndTurnButton());
  document.getElementById("btn-new-game")?.addEventListener("click", () => getScene()?.onNewGameButton());
  document.getElementById("btn-save")    ?.addEventListener("click", () => getScene()?.onSaveButton());
  document.getElementById("btn-load")    ?.addEventListener("click", () => getScene()?.onLoadButton());
  document.getElementById("btn-new-game-overlay")?.addEventListener("click", () => getScene()?.onNewGameButton());
});
