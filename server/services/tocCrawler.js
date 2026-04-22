'use strict';

const axios = require('axios');

const BASE = 'https://www.tabroom.com';
const DELAY_MS = 250;
const TIMEOUT_MS = 60000;

let _lastRequestAt = 0;

async function _throttle() {
  const elapsed = Date.now() - _lastRequestAt;
  if (elapsed < DELAY_MS) await new Promise(r => setTimeout(r, DELAY_MS - elapsed));
  _lastRequestAt = Date.now();
}

async function fetchTocCircuitId() {
  await _throttle();
  const res = await axios.get(`${BASE}/index/circuits.mhtml`, { timeout: TIMEOUT_MS });
  const html = String(res.data);
  const m = html.match(/TOC-UK[\s\S]*?circuit_id=(\d+)/);
  if (!m) throw new Error('tabroom: TOC-UK circuit not found');
  return Number(m[1]);
}

async function fetchCircuitTournIds(circuitId) {
  await _throttle();
  const res = await axios.get(`${BASE}/index/circuit/index.mhtml?circuit_id=${circuitId}`, { timeout: TIMEOUT_MS });
  const html = String(res.data);
  const ids = new Set();
  for (const m of html.matchAll(/tourn_id=(\d+)/g)) ids.add(Number(m[1]));
  return [...ids];
}

async function fetchTournamentJson(tournId) {
  await _throttle();
  const res = await axios.get(`${BASE}/api/download_data.mhtml?tourn_id=${tournId}`, { timeout: TIMEOUT_MS });
  if (typeof res.data === 'object') return res.data;
  return JSON.parse(String(res.data));
}

module.exports = { fetchTocCircuitId, fetchCircuitTournIds, fetchTournamentJson };
