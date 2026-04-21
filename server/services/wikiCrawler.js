'use strict';

const axios = require('axios');

const BASE = 'https://api.opencaselist.com/v1';
const DELAY_MS = 200;

let _cookie = null;
let _loginPromise = null;

async function _sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function _login() {
  if (_loginPromise) return _loginPromise;
  _loginPromise = (async () => {
    try {
      const res = await axios.post(`${BASE}/login`, {
        username: process.env.OPENCASELIST_USER,
        password: process.env.OPENCASELIST_PASS,
        remember: true,
      }, {
        validateStatus: s => s >= 200 && s < 300,
      });
      const setCookie = res.headers['set-cookie'];
      if (!setCookie) throw new Error('opencaselist login: no cookie returned');
      _cookie = setCookie.map(c => c.split(';')[0]).join('; ');
    } finally {
      _loginPromise = null;
    }
  })();
  return _loginPromise;
}

async function _get(path) {
  if (!_cookie) await _login();
  try {
    const res = await axios.get(`${BASE}${path}`, {
      headers: { Cookie: _cookie },
    });
    return res.data;
  } catch (err) {
    if (err.response?.status === 401) {
      _cookie = null;
      await _login();
      const res = await axios.get(`${BASE}${path}`, {
        headers: { Cookie: _cookie },
      });
      return res.data;
    }
    throw err;
  }
}

async function fetchCaselists() {
  return _get('/caselists');
}

async function fetchSchools(caselist) {
  await _sleep(DELAY_MS);
  return _get(`/caselists/${caselist}/schools`);
}

async function fetchTeams(caselist, school) {
  await _sleep(DELAY_MS);
  return _get(`/caselists/${caselist}/schools/${encodeURIComponent(school)}/teams`);
}

async function fetchRounds(caselist, school, team) {
  await _sleep(DELAY_MS);
  return _get(`/caselists/${caselist}/schools/${encodeURIComponent(school)}/teams/${encodeURIComponent(team)}/rounds`);
}

async function fetchCites(caselist, school, team) {
  await _sleep(DELAY_MS);
  return _get(`/caselists/${caselist}/schools/${encodeURIComponent(school)}/teams/${encodeURIComponent(team)}/cites`);
}

module.exports = { fetchCaselists, fetchSchools, fetchTeams, fetchRounds, fetchCites };
