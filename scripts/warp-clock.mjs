// Test-only preload: runs Date.now() OPC_WARP times faster than real time, starting at OPC_WARP_T0 (ms since epoch) when the real clock reads OPC_WARP_REAL_T0.
// scripts/smoke.mjs uses it so a "2 hour" flight completes in seconds. The server code itself has no clock switch.
const t0 = Number(process.env.OPC_WARP_T0);
const k = Number(process.env.OPC_WARP);
const real = Date.now.bind(Date);
const r0 = Number(process.env.OPC_WARP_REAL_T0);
Date.now = () => Math.floor(t0 + (real() - r0) * k);
