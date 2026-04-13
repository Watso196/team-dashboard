// ── SHARED MUTABLE STATE ──────────────────────────────────────────────────────
// Centralises the two pieces of mutable state that are written in one module
// (ui.js) and read across several others.

let CFG = {};
function setCFG(c) { CFG = Object.freeze(c); }

let RENDER_DATA = null;
function setRenderData(d) { RENDER_DATA = d; }
