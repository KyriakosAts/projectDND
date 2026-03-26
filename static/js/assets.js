/**
 * assets.js - Hero Quest: Digital Edition
 * Procedural sprite & texture generation via HTML5 Canvas.
 * All sprites are drawn programmatically – no external images needed.
 */

(function (window) {
  "use strict";

  const TILE_SIZE = 48;

  const COLORS = {
    // Tile colors
    floor:        "#2a2018",
    floorDetail:  "#231910",
    wall:         "#3a3228",
    wallDark:     "#1a1510",
    wallLight:    "#4a4038",
    door:         "#5a3010",
    doorFrame:    "#8b5a20",
    trap:         "#1a0a00",
    trapMark:     "#660000",
    // Heroes
    barbarian:    "#cc3333",
    mage:         "#3366cc",
    elf:          "#33cc33",
    dwarf:        "#cc9933",
    // Enemies
    goblin:       "#448822",
    zombie:       "#556622",
    chaos_warrior:"#880000",
    // UI
    gold:         "#c8960c",
    white:        "#ffffff",
    black:        "#000000",
    healthGreen:  "#33aa44",
    healthRed:    "#cc3333",
    highlight:    "rgba(50,200,50,0.35)",
    attackHighlight: "rgba(220,50,50,0.4)",
  };

  /**
   * Create a canvas-based Phaser texture key via a Graphics object.
   * Returns an object with `key` and a `create(scene)` function.
   */
  function makeTexture(key, size, drawFn) {
    return {
      key,
      create(scene) {
        if (scene.textures.exists(key)) return;
        const canvas = scene.textures.createCanvas(key, size, size);
        const ctx    = canvas.getContext("2d");
        drawFn(ctx, size);
        canvas.refresh();
      },
    };
  }

  // -----------------------------------------------------------------------
  // Tile textures
  // -----------------------------------------------------------------------

  const textures = [];

  // Floor
  textures.push(makeTexture("tile_floor", TILE_SIZE, (ctx, sz) => {
    ctx.fillStyle = COLORS.floor;
    ctx.fillRect(0, 0, sz, sz);
    // Subtle stone variation
    ctx.fillStyle = COLORS.floorDetail;
    for (let i = 0; i < 6; i++) {
      const x = Math.floor(Math.random() * sz);
      const y = Math.floor(Math.random() * sz);
      ctx.fillRect(x, y, 3, 2);
    }
    // Grid line
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(0.5, 0.5, sz - 1, sz - 1);
  }));

  // Wall
  textures.push(makeTexture("tile_wall", TILE_SIZE, (ctx, sz) => {
    ctx.fillStyle = COLORS.wall;
    ctx.fillRect(0, 0, sz, sz);
    // Brick pattern
    const bh = 10;
    ctx.strokeStyle = COLORS.wallDark;
    ctx.lineWidth = 1;
    for (let row = 0; row * bh < sz; row++) {
      const y = row * bh;
      const offset = (row % 2 === 0) ? 0 : sz / 2;
      for (let col = -1; col * (sz / 2) + offset < sz; col++) {
        const x = col * (sz / 2) + offset;
        ctx.strokeRect(x + 1, y + 1, sz / 2 - 2, bh - 2);
      }
    }
    // Highlight top-left edge
    ctx.fillStyle = COLORS.wallLight;
    ctx.fillRect(0, 0, sz, 2);
    ctx.fillRect(0, 0, 2, sz);
  }));

  // Door
  textures.push(makeTexture("tile_door", TILE_SIZE, (ctx, sz) => {
    ctx.fillStyle = COLORS.floor;
    ctx.fillRect(0, 0, sz, sz);
    // Door frame
    ctx.fillStyle = COLORS.doorFrame;
    ctx.fillRect(4, 0, sz - 8, sz);
    // Door panel
    ctx.fillStyle = COLORS.door;
    ctx.fillRect(8, 4, sz - 16, sz - 8);
    // Wood planks
    ctx.strokeStyle = "#3a1a00";
    ctx.lineWidth = 1.5;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(8, 4 + i * (sz - 12) / 3);
      ctx.lineTo(sz - 8, 4 + i * (sz - 12) / 3);
      ctx.stroke();
    }
    // Handle
    ctx.fillStyle = COLORS.gold;
    ctx.beginPath();
    ctx.arc(sz - 14, sz / 2, 3, 0, Math.PI * 2);
    ctx.fill();
  }));

  // Trap
  textures.push(makeTexture("tile_trap", TILE_SIZE, (ctx, sz) => {
    ctx.fillStyle = COLORS.trap;
    ctx.fillRect(0, 0, sz, sz);
    // Subtle X pattern
    ctx.strokeStyle = COLORS.trapMark;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.5;
    const m = 8;
    ctx.beginPath();
    ctx.moveTo(m, m); ctx.lineTo(sz - m, sz - m);
    ctx.moveTo(sz - m, m); ctx.lineTo(m, sz - m);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Border hint
    ctx.strokeStyle = "rgba(100,0,0,0.4)";
    ctx.lineWidth = 1;
    ctx.strokeRect(1, 1, sz - 2, sz - 2);
  }));

  // Highlight overlays
  textures.push(makeTexture("highlight_move", TILE_SIZE, (ctx, sz) => {
    ctx.fillStyle = "rgba(40,180,80,0.32)";
    ctx.fillRect(0, 0, sz, sz);
    ctx.strokeStyle = "rgba(80,255,120,0.7)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(1, 1, sz - 2, sz - 2);
  }));

  textures.push(makeTexture("highlight_attack", TILE_SIZE, (ctx, sz) => {
    ctx.fillStyle = "rgba(200,30,30,0.35)";
    ctx.fillRect(0, 0, sz, sz);
    ctx.strokeStyle = "rgba(255,80,80,0.8)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(1, 1, sz - 2, sz - 2);
  }));

  textures.push(makeTexture("highlight_spell", TILE_SIZE, (ctx, sz) => {
    ctx.fillStyle = "rgba(60,60,200,0.35)";
    ctx.fillRect(0, 0, sz, sz);
    ctx.strokeStyle = "rgba(120,120,255,0.8)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(1, 1, sz - 2, sz - 2);
  }));

  // -----------------------------------------------------------------------
  // Character sprites (48×48, drawn as colored tokens)
  // -----------------------------------------------------------------------

  function makeCharSprite(key, color, letter, shape) {
    return makeTexture(key, TILE_SIZE, (ctx, sz) => {
      const cx = sz / 2, cy = sz / 2, r = sz / 2 - 4;
      // Shadow
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.beginPath();
      ctx.ellipse(cx + 2, cy + 2, r, r * 0.85, 0, 0, Math.PI * 2);
      ctx.fill();
      // Body
      ctx.fillStyle = color;
      if (shape === "diamond") {
        ctx.beginPath();
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r, cy);
        ctx.lineTo(cx, cy + r);
        ctx.lineTo(cx - r, cy);
        ctx.closePath();
      } else if (shape === "hex") {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i - Math.PI / 6;
          const x = cx + r * Math.cos(a);
          const y = cy + r * Math.sin(a);
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.closePath();
      } else {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
      }
      ctx.fill();
      // Border
      ctx.strokeStyle = lightenColor(color, 0.4);
      ctx.lineWidth = 2;
      ctx.stroke();
      // Letter label
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${Math.floor(sz * 0.38)}px Palatino, serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(0,0,0,0.8)";
      ctx.shadowBlur  = 3;
      ctx.fillText(letter, cx, cy + 1);
      ctx.shadowBlur = 0;
    });
  }

  function lightenColor(hex, amount) {
    const num = parseInt(hex.replace("#", ""), 16);
    const r   = Math.min(255, ((num >> 16) & 0xff) + Math.round(255 * amount));
    const g   = Math.min(255, ((num >> 8)  & 0xff) + Math.round(255 * amount));
    const b   = Math.min(255, ( num        & 0xff) + Math.round(255 * amount));
    return `rgb(${r},${g},${b})`;
  }

  // Heroes
  textures.push(makeCharSprite("hero_barbarian", COLORS.barbarian, "B", "circle"));
  textures.push(makeCharSprite("hero_mage",      COLORS.mage,      "M", "diamond"));
  textures.push(makeCharSprite("hero_elf",       COLORS.elf,       "E", "hex"));
  textures.push(makeCharSprite("hero_dwarf",     COLORS.dwarf,     "D", "circle"));

  // Enemies
  textures.push(makeCharSprite("enemy_goblin",        COLORS.goblin,        "G", "circle"));
  textures.push(makeCharSprite("enemy_zombie",        COLORS.zombie,        "Z", "hex"));
  textures.push(makeCharSprite("enemy_chaos_warrior", COLORS.chaos_warrior, "C", "diamond"));

  // Dead marker
  textures.push(makeTexture("dead_marker", TILE_SIZE, (ctx, sz) => {
    ctx.fillStyle = "rgba(0,0,0,0)";
    ctx.fillRect(0, 0, sz, sz);
    ctx.strokeStyle = "rgba(150,0,0,0.8)";
    ctx.lineWidth = 3;
    const m = 10;
    ctx.beginPath();
    ctx.moveTo(m, m);     ctx.lineTo(sz - m, sz - m);
    ctx.moveTo(sz - m, m); ctx.lineTo(m, sz - m);
    ctx.stroke();
  }));

  // Hit flash
  textures.push(makeTexture("hit_flash", TILE_SIZE, (ctx, sz) => {
    ctx.fillStyle = "rgba(255,50,50,0.7)";
    ctx.beginPath();
    ctx.arc(sz / 2, sz / 2, sz / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
  }));

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  window.GameAssets = {
    TILE_SIZE,
    COLORS,
    textures,

    /** Call once in Phaser BootScene to create all textures */
    createAll(scene) {
      textures.forEach(t => t.create(scene));
    },

    /** Resolve sprite key from an entity */
    heroKey(hero) {
      return `hero_${hero.sprite || hero.id}`;
    },

    enemyKey(enemy) {
      const type = enemy.sprite || enemy.type || "goblin";
      return `enemy_${type}`;
    },
  };

})(window);
