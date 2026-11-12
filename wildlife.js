/* Deer & elk movement model.
   Terrain-only heuristic (slope, aspect, elevation band, benches, saddles, drainages)
   shifted by species, season, weather and time of day. No vegetation, roads, pressure
   or live animal data. Scouting aid only. */
(function (root) {
'use strict';
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v;
const plateau = (v, a, b, c, d) => v <= a || v >= d ? 0 : v < b ? (v - a) / (b - a) : v <= c ? 1 : (d - v) / (d - c);

const SPECIES = {
  elk:   { bedPeak: 20, bedLo: 5, bedHi: 38, feedMax: 16, posShift: 0,   saddle: 1,  bench: .8, valley: .55, roadFloor: .25, refuge: 1 },
  mule:  { bedPeak: 26, bedLo: 8, bedHi: 42, feedMax: 20, posShift: 15,  saddle: 1,  bench: 1,  valley: .5, roadFloor: .45, refuge: .6 },
  white: { bedPeak: 10, bedLo: 0, bedHi: 24, feedMax: 12, posShift: -25, saddle: .8, bench: .7, valley: 1, roadFloor: .6, refuge: .5 }
};
// Preferred elevation band as a percentile of the modeled area.
const SEASON = { summer: [.55, 1], early: [.45, .95], rut: [.3, .85], late: [.15, .7], winter: [0, .4] };
// Behavior weights by time of day.
const TIME = {
  dawn:   { bed: .55, feed: .8,  travel: 1 },
  midday: { bed: 1,   feed: .2,  travel: .35 },
  dusk:   { bed: .35, feed: 1,   travel: 1 },
  night:  { bed: .5,  feed: .85, travel: .5 }
};
// Hunting-season effects. dref = distance from motorized routes at which disturbance stops mattering;
// boost = how strongly animals favor land that restricts public hunter access (strongest in rifle season).
const HUNT = { off: { dref: 400, boost: 0 }, archery: { dref: 1500, boost: .4 }, rifle: { dref: 2760, boost: 1 } };
const THR = .3;
const COLORS = { bed: [139, 107, 255], feed: [245, 224, 80], travel: [255, 107, 61] };
const NOTES = {
  dawn: 'Dawn: animals leave feeding areas and climb toward bedding. Cool air drains downhill until shortly after sunrise, then thermals start rising.',
  midday: 'Midday: most animals are bedded. Thermals rise, so expect them to bed with the wind or terrain covering their backs and a view below.',
  dusk: 'Dusk: animals leave bedding and drop toward feeding. Thermals fall as the slopes cool, carrying scent downhill.',
  night: 'Night: feeding dominates, with some travel between feeding patches. Air drains downhill all night.'
};

function boxBlur(src, W, H, r) {
  const out = new Float32Array(W * H), S = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) { row += src[y * W + x]; S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + row; }
  }
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1);
      out[y * W + x] = (S[y1 * (W + 1) + x1] - S[y0 * (W + 1) + x1] - S[y1 * (W + 1) + x0] + S[y0 * (W + 1) + x0]) / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

function compute(D, o) {
  const { el, W, H, cs } = D, N = W * H;
  const hunt = HUNT[o.hunt] || HUNT.off, sp = SPECIES[o.species] || SPECIES.elk, band = SEASON[o.season] || SEASON.early, tw = TIME[o.time] || TIME.dawn;
  const rs = m => Math.max(1, Math.round(m / cs));
  const e1 = boxBlur(el, W, H, rs(20)), e2 = boxBlur(el, W, H, rs(30));
  const m600 = boxBlur(e1, W, H, rs(600));
  const slope = new Float32Array(N), north = new Float32Array(N), east = new Float32Array(N);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, dx = (e1[i + 1] - e1[i - 1]) / (2 * cs), dy = (e1[i + W] - e1[i - W]) / (2 * cs), g = Math.hypot(dx, dy);
    slope[i] = deg(Math.atan(g));
    north[i] = g > 1e-4 ? dy / g : 0; // y grows south, so dy>0 means the slope faces north
    east[i] = g > 1e-4 ? -dx / g : 0;  // downslope east component
  }
  const sMean = boxBlur(slope, W, H, rs(150));

  // Elevation percentile within the area.
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < N; i++) { const v = e1[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const BINS = 512, cdf = new Float32Array(BINS), span = Math.max(1e-6, hi - lo);
  for (let i = 0; i < N; i++) cdf[Math.min(BINS - 1, ((e1[i] - lo) / span * BINS) | 0)]++;
  for (let b = 1; b < BINS; b++) cdf[b] += cdf[b - 1];
  const pct = v => cdf[Math.min(BINS - 1, ((v - lo) / span * BINS) | 0)] / N;

  // Hessian-based saddle / concavity.
  const h = Math.max(2, rs(45)), step = h * cs, det = new Float32Array(N), lap = new Float32Array(N);
  for (let y = h; y < H - h; y++) for (let x = h; x < W - h; x++) {
    const i = y * W + x, c = e2[i];
    const fxx = (e2[i + h] - 2 * c + e2[i - h]) / (step * step), fyy = (e2[i + h * W] - 2 * c + e2[i - h * W]) / (step * step);
    const fxy = (e2[i + h * W + h] - e2[i + h * W - h] - e2[i - h * W + h] + e2[i - h * W - h]) / (4 * step * step);
    det[i] = fxx * fyy - fxy * fxy; lap[i] = fxx + fyy;
  }
  const cand = [];
  for (let i = 0; i < N; i++) if (det[i] < 0 && e1[i] - m600[i] > -25 && slope[i] < 20) cand.push(-det[i]);
  const cs2 = Float32Array.from(cand).sort();
  const dScale = cs2.length ? Math.max(1e-12, cs2[Math.floor(cs2.length * .95)]) : 1;

  const saddleRaw = new Float32Array(N);
  for (let i = 0; i < N; i++) if (det[i] < 0 && e1[i] - m600[i] > -25 && slope[i] < 20) saddleRaw[i] = clamp(-det[i] / dScale) * clamp(1 - slope[i] / 20);
  const saddleBlur = boxBlur(saddleRaw, W, H, 2);

  // Warm weather favors shade (north), cold favors sun (south); winter always favors south.
  const k = o.season === 'winter' ? -1 : o.wx === 'hot' ? 1 : o.wx === 'cold' ? -1 : .25;
  const wt = o.windMph > 0 ? rad((o.windFrom || 0) + 180) : null, wS = wt === null ? 0 : Math.sin(wt), wC = wt === null ? 0 : Math.cos(wt), wK = clamp((o.windMph || 0) / 20), act = o.activity || 1;
  const bed = new Float32Array(N), feed = new Float32Array(N), travel = new Float32Array(N), rgba = new Uint8ClampedArray(N * 4);
  const cnt = { bed: 0, feed: 0, travel: 0 };
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, s = slope[i], tpi = e1[i] - m600[i], p = pct(e1[i]);
    const bench = clamp(1 - s / 12) * clamp((sMean[i] - 12) / 12) * (s < 10 ? 1 : 0);
    const valley = tpi < -12 && lap[i] > 0 ? clamp(-tpi / 35) * clamp(1 - s / 18) : 0;
    const saddle = Math.max(saddleRaw[i], saddleBlur[i]);
    const dBand = p < band[0] ? band[0] - p : p > band[1] ? p - band[1] : 0, elevF = Math.max(.15, 1 - dBand / .25);

    // Bedding: moderate slopes, mid-to-upper position, secluded terrain, comfortable aspect.
    const slopeFit = plateau(s, sp.bedLo - 6, sp.bedPeak - 4, sp.bedPeak + 4, sp.bedHi);
    const posF = .2 + .8 * plateau(tpi - sp.posShift, -50, -5, 45, 110);
    const aspBed = .65 + .35 * k * north[i];
    const sec = .7 + .3 * clamp((sMean[i] - 8) / 14);
    const lee = east[i] * wS + north[i] * wC; // +1 = slope faces downwind (sheltered)
    bed[i] = clamp(slopeFit * posF * aspBed * elevF * sec * (1 + .35 * bench) * (1 + .15 * lee * wK));

    // Feeding: gentle ground, low-to-mid position, benches and bottoms get a bonus.
    const gentle = Math.pow(clamp(1 - s / sp.feedMax), .7);
    const feedElev = Math.max(.25, 1 - dBand / .4);
    feed[i] = clamp(gentle * feedElev * (.8 + .2 * k * north[i]) * (.55 + .45 * Math.max(valley, bench, p < .5 ? .5 : 0)));

    // Travel: saddles, benches and drainage bottoms.
    travel[i] = s < 30 ? clamp(Math.max(saddle * sp.saddle, bench * sp.bench, valley * sp.valley)) : 0;

    // Human pressure: distance from motorized routes, and (in season) preference for land closed to public hunters.
    if (o.roadDist) {
      const rf = sp.roadFloor + (1 - sp.roadFloor) * clamp(o.roadDist[i] / hunt.dref);
      bed[i] *= rf; feed[i] *= rf; travel[i] *= .5 + .5 * rf;
    }
    if (o.access && hunt.boost > 0 && o.access[i]) { const pf = 1 - .3 * hunt.boost * sp.refuge; bed[i] *= pf; feed[i] *= pf; }

    const B = bed[i] * tw.bed, F = feed[i] * tw.feed * act, T = travel[i] * tw.travel * act;
    const v = Math.max(B, F, T);
    if (v >= THR) {
      const c = v === T ? COLORS.travel : v === B ? COLORS.bed : COLORS.feed;
      rgba[4 * i] = c[0]; rgba[4 * i + 1] = c[1]; rgba[4 * i + 2] = c[2];
      rgba[4 * i + 3] = 50 + 190 * clamp((v - THR) / .6);
      cnt[v === T ? 'travel' : v === B ? 'bed' : 'feed']++;
    }
  }
  return { W, H, bed, feed, travel, rgba, stats: { bed: cnt.bed / N, feed: cnt.feed / N, travel: cnt.travel / N } };
}

/* ---------- Live conditions: sun, moon, weather ---------- */
const JD = ms => ms / 86400000 + 2440587.5, fromJD = j => (j - 2440587.5) * 86400000;
// NOAA sunrise equation. Returns UTC ms for the solar day whose transit is nearest `ms`.
function sunTimes(lat, lng, ms) {
  const phi = rad(lat), base = Math.ceil(JD(ms) - 2451545.0 + 0.0008);
  let best = null;
  for (let n = base - 1; n <= base + 1; n++) {
    const Js = n - lng / 360, M = (357.5291 + 0.98560028 * Js) % 360, Mr = rad(M);
    const C = 1.9148 * Math.sin(Mr) + 0.02 * Math.sin(2 * Mr) + 0.0003 * Math.sin(3 * Mr);
    const lam = rad((M + C + 180 + 102.9372) % 360), tr = 2451545.0 + Js + 0.0053 * Math.sin(Mr) - 0.0069 * Math.sin(2 * lam);
    const sd = Math.sin(lam) * Math.sin(rad(23.4397)), cd = Math.cos(Math.asin(sd));
    const c0 = (Math.sin(rad(-.833)) - Math.sin(phi) * sd) / (Math.cos(phi) * cd);
    if (c0 < -1 || c0 > 1) continue; // polar day/night
    const w = deg(Math.acos(c0)) / 360, cand = { rise: fromJD(tr - w), set: fromJD(tr + w), transit: fromJD(tr) };
    if (!best || Math.abs(cand.transit - ms) < Math.abs(best.transit - ms)) best = cand;
  }
  return best;
}
function moonPhase(ms) {
  const P = 29.530588853, age = (((JD(ms) - 2451550.1) % P) + P) % P, illum = (1 - Math.cos(2 * Math.PI * age / P)) / 2;
  const names = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  return { age, illum, name: names[Math.floor(((age / P) * 8 + .5)) % 8] };
}
const H = 3600000;
function timeClass(ms, sun) {
  if (!sun) return 'midday';
  if (ms >= sun.rise - 1 * H && ms < sun.rise + 2 * H) return 'dawn';
  if (ms >= sun.set - 2 * H && ms < sun.set + 1 * H) return 'dusk';
  return ms >= sun.rise + 2 * H && ms < sun.set - 2 * H ? 'midday' : 'night';
}
const WX_URL = (lat, lng) => 'https://api.open-meteo.com/v1/forecast?latitude=' + lat.toFixed(4) + '&longitude=' + lng.toFixed(4) +
  '&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,surface_pressure,cloud_cover,precipitation,snow_depth' +
  '&temperature_unit=fahrenheit&wind_speed_unit=mph&past_days=1&forecast_days=3&timezone=auto';
// Pick the hourly row nearest `ms` and derive what matters for movement.
function conditionsAt(wx, ms) {
  const hr = wx.hourly, off = (wx.utc_offset_seconds || 0) * 1000, t = hr.time.map(x => Date.parse(x + 'Z') - off);
  let i = 0; for (let k = 1; k < t.length; k++) if (Math.abs(t[k] - ms) < Math.abs(t[i] - ms)) i = k;
  if (Math.abs(t[i] - ms) > 2 * H) throw new Error('Forecast does not cover that time');
  const at = (a, k) => a[Math.max(0, Math.min(a.length - 1, k))];
  return {
    tempF: hr.temperature_2m[i], windMph: hr.wind_speed_10m[i], windFrom: hr.wind_direction_10m[i], cloud: hr.cloud_cover[i],
    precipMm: hr.precipitation[i] || 0, snowM: hr.snow_depth[i] || 0,
    dP6: at(hr.surface_pressure, i) - at(hr.surface_pressure, i - 6),
    tempDrop12: at(hr.temperature_2m, i) - at(hr.temperature_2m, i + 12)
  };
}
// Turn conditions into model options (season shifts with snow, activity with weather).
function liveOptions(base, c) {
  const notes = [], o = { ...base };
  o.wx = c.tempF >= 72 ? 'hot' : c.tempF <= 35 ? 'cold' : 'mild';
  if (c.snowM >= .3) { if (o.season !== 'winter') notes.push('Deep snow: using winter range'); o.season = 'winter'; }
  else if (c.snowM >= .1 && ['summer', 'early', 'rut'].includes(o.season)) { o.season = 'late'; notes.push('Snow on the ground: shifted toward lower ground'); }
  let act = 1;
  if (c.dP6 <= -3) { act *= 1.15; notes.push('Pressure falling fast: movement bump'); }
  if (c.tempDrop12 >= 12) { act *= 1.1; notes.push('Cold front coming: movement bump'); }
  if (c.windMph >= 25 || c.precipMm >= 2.5) { act *= .85; notes.push('Strong wind or heavy precip: less movement'); }
  o.activity = Math.max(.8, Math.min(1.3, act));
  o.windMph = c.windMph; o.windFrom = c.windFrom;
  return { opts: o, notes };
}

/* ---------- IDFG seasonal-range layers (public ArcGIS map services) ---------- */
const IDFG_BASE = 'https://gisportal-idfg.idaho.gov/hosting/rest/services/Wildlife/';
const IDFG_SERVICES = { elk: 'Elk_Seasonal_Ranges', mule: 'Mule_Deer_Seasonal_Ranges' }; // no public whitetail service found
// Which kind of layer to show: explicit choice, or by season (rut shows both ranges).
function idfgWanted(choice, season) {
  if (choice !== 'auto') return [choice];
  return season === 'summer' || season === 'early' ? ['summer'] : season === 'rut' ? ['winter', 'summer'] : ['winter'];
}
// Match service layer names ("Mule Deer Winter Range", "Elk Migration Routes", ...) to wanted kinds.
function pickLayers(layers, wanted) {
  const re = { winter: /winter/i, summer: /summer/i, migration: /migrat|route|corridor/i };
  return (layers || []).filter(l => wanted.some(w => re[w].test(l.name || ''))).map(l => ({ id: l.id, name: l.name }));
}
const idfgTiles = (svc, ids) => IDFG_BASE + svc + '/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image&layers=show:' + ids.join(',');

/* ---------- Roads and public land rasters ---------- */
// Rasterize polylines (arrays of [x,y] in cell coordinates) into a W*H mask.
function rasterizeLines(lines, W, H) {
  const m = new Uint8Array(W * H), mark = (x, y) => { const ix = Math.floor(x), iy = Math.floor(y); if (ix >= 0 && iy >= 0 && ix < W && iy < H) m[iy * W + ix] = 1; };
  for (const ln of lines) for (let k = 0; k < ln.length; k++) {
    if (k === 0) { mark(ln[0][0], ln[0][1]); continue; }
    const [x0, y0] = ln[k - 1], [x1, y1] = ln[k], n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / .5));
    for (let t = 0; t <= n; t++) mark(x0 + (x1 - x0) * t / n, y0 + (y1 - y0) * t / n);
  }
  return m;
}
// Even-odd scanline fill. polys = array of polygons; each polygon = array of rings of [x,y] in cell coordinates (holes included).
function fillPolygons(polys, W, H) {
  const m = new Uint8Array(W * H);
  for (const rings of polys) {
    let y0 = Infinity, y1 = -Infinity;
    for (const r of rings) for (const p of r) { if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(H - 1, Math.ceil(y1)); y++) {
      const yc = y + .5, xs = [];
      for (const r of rings) for (let k = 1; k < r.length; k++) {
        const a = r[k - 1], b = r[k];
        if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) xs.push(a[0] + (yc - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2)
        for (let x = Math.max(0, Math.ceil(xs[k] - .5)); x <= Math.min(W - 1, Math.floor(xs[k + 1] - .5)); x++) m[y * W + x] = 1;
    }
  }
  return m;
}
// Two-pass chamfer distance (meters) from cells where mask=1. No roads at all returns 1e6 everywhere.
function chamfer(mask, W, H, cs) {
  const INF = 1e9, d = new Float32Array(W * H), a = cs, b = cs * Math.SQRT2;
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : INF;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + a);
    if (y > 0) { v = Math.min(v, d[i - W] + a); if (x > 0) v = Math.min(v, d[i - W - 1] + b); if (x < W - 1) v = Math.min(v, d[i - W + 1] + b); }
    d[i] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x; let v = d[i];
    if (x < W - 1) v = Math.min(v, d[i + 1] + a);
    if (y < H - 1) { v = Math.min(v, d[i + W] + a); if (x < W - 1) v = Math.min(v, d[i + W + 1] + b); if (x > 0) v = Math.min(v, d[i + W - 1] + b); }
    d[i] = v;
  }
  for (let i = 0; i < d.length; i++) if (d[i] >= INF) d[i] = 1e6;
  return d;
}
// Overpass query: roads a vehicle could plausibly use (OSM carries few seasonal closures).
const roadsQuery = (lo, hi) => '[out:json][timeout:25];way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|track)$"]["motor_vehicle"!~"^(no|private)$"]["access"!~"^(no|private)$"](' + [lo[1], lo[0], hi[1], hi[0]].map(v => v.toFixed(5)).join(',') + ');out geom;';
const PADUS = 'https://services.arcgis.com/v01gqwM5QqNysAAi/ArcGIS/rest/services/PADUS_Protected_Areas_National/FeatureServer/0/query';
const padusUrl = (lo, hi, filtered) => PADUS + '?where=' + encodeURIComponent(filtered ? "Pub_Access='OA'" : '1=1') + '&geometry=' + [lo[0], lo[1], hi[0], hi[1]].join(',') +
  '&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=Pub_Access,Mang_Type&returnGeometry=true&outSR=4326&maxAllowableOffset=0.0002&resultRecordCount=2000&f=geojson';

const api = { compute, rasterizeLines, fillPolygons, chamfer, roadsQuery, padusUrl, HUNT, idfgWanted, pickLayers, idfgTiles, boxBlur, sunTimes, moonPhase, timeClass, conditionsAt, liveOptions, SPECIES, SEASON, TIME, NOTES, COLORS };
if (typeof module === 'object' && module.exports) module.exports = api;
root.Wildlife = api;

/* ---------- Panel UI (browser only) ---------- */
if (typeof document === 'undefined' || typeof map === 'undefined' || !document.getElementById('bLos')) return;

const KEY = 'mgrs-wl';
let saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) {}
const opt = (v, t, cur) => `<option value="${v}"${cur === v ? ' selected' : ''}>${t}</option>`;
const panelSec = document.createElement('details');
panelSec.className = 'tool-section';
panelSec.innerHTML = `<summary>Deer &amp; elk movement</summary><div>
  <label>Species, season, radius</label>
  <div class="row"><select id="wlSp" aria-label="Species">${opt('elk', 'Elk', saved.sp)}${opt('mule', 'Mule deer', saved.sp)}${opt('white', 'Whitetail', saved.sp)}</select>
  <select id="wlSeason" aria-label="Season">${opt('summer', 'Summer', saved.season)}${opt('early', 'Early fall', saved.season || 'early')}${opt('rut', 'Rut', saved.season)}${opt('late', 'Late fall', saved.season)}${opt('winter', 'Winter', saved.season)}</select>
  <select id="wlR" aria-label="Radius">${opt('2', '2 km', saved.r)}${opt('5', '5 km', saved.r || '5')}${opt('10', '10 km', saved.r)}</select></div>
  <label>When</label>
  <div class="row"><select id="wlAhead" aria-label="Hours ahead">${opt('0', 'Now', saved.ahead)}${opt('3', '+3 h', saved.ahead)}${opt('6', '+6 h', saved.ahead)}${opt('12', '+12 h', saved.ahead)}${opt('24', '+24 h', saved.ahead)}${opt('48', '+48 h', saved.ahead)}</select>
  <select id="wlTime" aria-label="Time of day">${opt('auto', 'Auto (sunrise/sunset)', saved.time || 'auto')}${opt('dawn', 'Dawn', saved.time)}${opt('midday', 'Midday', saved.time)}${opt('dusk', 'Dusk', saved.time)}${opt('night', 'Night', saved.time)}</select></div>
  <div class="row"><label style="margin:0;align-self:center"><input id="wlLive" type="checkbox"${saved.live === false ? '' : ' checked'}> Use live conditions (weather, wind, snow)</label></div>
  <label>Hunting season and human pressure</label>
  <div class="row"><select id="wlHunt" aria-label="Hunting season">${opt('off', 'Off-season', saved.hunt)}${opt('archery', 'Archery season', saved.hunt)}${opt('rifle', 'Rifle season', saved.hunt)}</select>
  <label style="margin:0;align-self:center"><input id="wlHuman" type="checkbox"${saved.human === false ? '' : ' checked'}> Roads &amp; public land</label></div>
  <div class="row" id="wlWxRow"><select id="wlWx" aria-label="Manual weather">${opt('mild', 'Mild (manual)', saved.wx)}${opt('hot', 'Hot (manual)', saved.wx)}${opt('cold', 'Cold (manual)', saved.wx)}</select></div>
  <label>Idaho Fish and Game seasonal ranges (GPS-collar habitat models)</label>
  <div class="row"><select id="wlIdfg" aria-label="IDFG layer">${opt('off', 'IDFG layer: off', saved.idfg || 'off')}${opt('auto', 'Auto (by season)', saved.idfg)}${opt('winter', 'Winter range', saved.idfg)}${opt('summer', 'Summer range', saved.idfg)}${opt('migration', 'Migration routes', saved.idfg)}</select></div>
  <div id="wlIdfgMsg" class="hint" role="status"></div>
  <div class="row"><button id="wlGo" class="p">Predict at map center</button><button id="wlClr">Clear</button></div>
  <div class="hint" style="margin:6px 0"><b style="color:#8b6bff">&#9632;</b> Bedding &nbsp; <b style="color:#f5e050">&#9632;</b> Feeding &nbsp; <b style="color:#ff6b3d">&#9632;</b> Travel (saddles, benches, drainages)</div>
  <div id="wlMsg" class="hint" role="status" style="white-space:pre-line"></div>
  <p class="hint">Terrain plus conditions estimate. It does not see vegetation, roads, water, hunting pressure or real animals, so confirm with sign, trail cams and local knowledge. Live weather by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a>. Roads © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>; public land from USGS PAD-US. If it can't load, the manual weather setting is used.</p>
</div>`;
const anchor = $('bLos').closest('details') || $('bLos').closest('#panel > div');
anchor.after(panelSec);

const wmsg = t => { $('wlMsg').textContent = t || ''; };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ sp: $('wlSp').value, season: $('wlSeason').value, wx: $('wlWx').value, r: $('wlR').value, idfg: $('wlIdfg').value, hunt: $('wlHunt').value, human: $('wlHuman').checked, ahead: $('wlAhead').value, time: $('wlTime').value, live: $('wlLive').checked })); } catch (e) {} };
const syncLive = () => { $('wlWxRow').style.opacity = $('wlLive').checked ? .5 : 1; };
let busy = false;

function clearWL() {
  if (map.getLayer('wl')) map.removeLayer('wl');
  if (map.getSource('wl')) map.removeSource('wl');
  if (map.getLayer('wl-roads')) map.removeLayer('wl-roads');
  if (map.getSource('wl-roads')) map.removeSource('wl-roads');
  wmsg('');
}
async function fetchWx(lat, lng) {
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch(WX_URL(lat, lng), { signal: ctl.signal });
    if (!r.ok) throw new Error('weather service returned ' + r.status);
    return await r.json();
  } finally { clearTimeout(to); }
}
async function fetchJson(url, opts, ms) {
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), ms || 20000);
  try {
    const r = await fetch(url, { ...(opts || {}), signal: ctl.signal });
    if (!r.ok) throw new Error('service returned ' + r.status);
    return await r.json();
  } catch (err) { throw new Error(err.name === 'AbortError' ? 'timed out' : err.message); } finally { clearTimeout(to); }
}
const fetchRoads = (lo, hi) => fetchJson('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(roadsQuery(lo, hi)), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, 25000);
async function fetchAccess(lo, hi) {
  let j = await fetchJson(padusUrl(lo, hi, true), null, 20000);
  if (j.error) j = await fetchJson(padusUrl(lo, hi, false), null, 20000); // field filter rejected: filter client-side
  if (j.error) throw new Error(j.error.message || 'query error');
  return j;
}
const ringsOf = g => !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
async function run() {
  if (busy) return;
  busy = true; $('wlGo').disabled = true; save();
  try {
    const c = map.getCenter(), Rm = +$('wlR').value * 1000, dLat = Rm / 111320, dLng = Rm / (111320 * Math.cos(rad(c.lat)));
    const target = Date.now() + (+$('wlAhead').value) * H, lines = [];
    let base = { species: $('wlSp').value, season: $('wlSeason').value, wx: $('wlWx').value, time: $('wlTime').value }, o = base, notes = [], liveOk = false;
    const sun = sunTimes(c.lat, c.lng, target), moon = moonPhase(target);
    if (base.time === 'auto') base.time = timeClass(target, sun);
    if ($('wlLive').checked) {
      wmsg('Loading conditions…');
      try {
        const cond = conditionsAt(await fetchWx(c.lat, c.lng), target), lo = liveOptions(base, cond);
        o = lo.opts; notes = lo.notes; liveOk = true;
        const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        lines.push(`Conditions: ${Math.round(cond.tempF)}°F, wind from ${dirs[Math.round(cond.windFrom / 45) % 8]} ${Math.round(cond.windMph)} mph, pressure ${cond.dP6 >= 0 ? '+' : ''}${cond.dP6.toFixed(1)} hPa/6h, snow ${Math.round(cond.snowM * 39.37)} in.`);
      } catch (err) { lines.push('Live conditions unavailable (' + err.message + '). Using manual weather.'); }
    }
    wmsg('Loading terrain…');
    const lo = [c.lng - dLng, c.lat - dLat], hi = [c.lng + dLng, c.lat + dLat];
    const D = await loadDEM(lo, hi, 1.2e6);
    let roadDist = null, access = null, roadLines = [];
    if ($('wlHuman').checked) {
      wmsg('Loading roads and public land…');
      const [rr, aa] = await Promise.allSettled([fetchRoads(lo, hi), fetchAccess(lo, hi)]);
      if (rr.status === 'fulfilled') {
        roadLines = (rr.value.elements || []).filter(e => e.geometry && e.geometry.length > 1).map(e => e.geometry.map(p => [p.lon, p.lat]));
        roadDist = chamfer(rasterizeLines(roadLines.map(l => l.map(p => D.px(p[0], p[1]))), D.W, D.H), D.W, D.H, D.cs);
        lines.push(`Roads: ${roadLines.length} OpenStreetMap segments (closures and gates are often missing, so check the unit).`);
      } else lines.push('Roads unavailable (' + rr.reason.message + '). Skipping the road effect.');
      if (aa.status === 'fulfilled') {
        const feats = (aa.value.features || []).filter(f => !f.properties || f.properties.Pub_Access === 'OA');
        if (feats.length) {
          const polys = [].concat(...feats.map(f => ringsOf(f.geometry))).map(poly => poly.map(ring => ring.map(p => D.px(p[0], p[1]))));
          access = fillPolygons(polys, D.W, D.H);
          let n = 0; for (let i = 0; i < access.length; i++) n += access[i];
          lines.push(`Public land open to access: about ${Math.round(100 * n / access.length)}% of the area (USGS PAD-US; unmapped land is treated as private or restricted).`);
        } else lines.push('PAD-US returned no open-access land here, so the access effect is skipped.');
      } else lines.push('Public land data unavailable (' + aa.reason.message + '). Skipping the access effect.');
    }
    o = { ...o, hunt: $('wlHunt').value, roadDist, access };
    wmsg('Modeling…'); await tick();
    const out = compute(D, o);
    clearWL();
    if (roadLines.length) {
      map.addSource('wl-roads', { type: 'geojson', data: { type: 'FeatureCollection', features: roadLines.map(l => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: l } })) } });
      map.addLayer({ id: 'wl-roads', type: 'line', source: 'wl-roads', paint: { 'line-color': '#e8e8e8', 'line-width': 1, 'line-opacity': .55 } }, 'grid');
    }
    const cv = document.createElement('canvas'); cv.width = D.W; cv.height = D.H;
    const cx = cv.getContext('2d'), im = cx.createImageData(D.W, D.H); im.data.set(out.rgba); cx.putImageData(im, 0, 0);
    map.addSource('wl', { type: 'image', url: cv.toDataURL(), coordinates: [D.ll(0, 0), D.ll(D.W, 0), D.ll(D.W, D.H), D.ll(0, D.H)] });
    map.addLayer({ id: 'wl', type: 'raster', source: 'wl', paint: { 'raster-opacity': .8, 'raster-resampling': 'linear' } }, 'grid');
    const pc = v => Math.round(v * 100) + '%', fmt = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const head = [NOTES[o.time]];
    if (sun) head.push(`Sunrise ${fmt(sun.rise)}, sunset ${fmt(sun.set)}. Moon: ${moon.name}, ${Math.round(moon.illum * 100)}% lit (not used by the model).`);
    wmsg(head.concat(lines, notes.map(n => n + '.'), [`Highlighted: bedding ${pc(out.stats.bed)}, feeding ${pc(out.stats.feed)}, travel ${pc(out.stats.travel)} of the ${Rm * 2 / 1000} km square around ${fmtMGRS(c.lng, c.lat)}. Elevation bands are relative to this area.`]).join('\n'));
  } catch (err) { wmsg('Prediction failed: ' + err.message); }
  busy = false; $('wlGo').disabled = false;
}
const imsg = t => { $('wlIdfgMsg').textContent = t || ''; };
let idfgToken = 0;
function clearIdfg() { if (map.getLayer('idfg')) map.removeLayer('idfg'); if (map.getSource('idfg')) map.removeSource('idfg'); }
async function updateIdfg() {
  const tok = ++idfgToken, choice = $('wlIdfg').value, sp = $('wlSp').value;
  clearIdfg(); imsg('');
  if (choice === 'off') return;
  const svc = IDFG_SERVICES[sp];
  if (!svc) { imsg('Idaho Fish and Game has no public whitetail range layer that I could find. Pick elk or mule deer.'); return; }
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 9000);
  try {
    imsg('Loading IDFG layers…');
    const r = await fetch(IDFG_BASE + svc + '/MapServer?f=json', { signal: ctl.signal });
    if (!r.ok) throw new Error('service returned ' + r.status);
    const info = await r.json();
    if (info.error) throw new Error(info.error.message || 'service error'); // ArcGIS returns HTTP 200 with an error body (e.g. "Token Required")
    const picked = pickLayers(info.layers, idfgWanted(choice, $('wlSeason').value));
    if (tok !== idfgToken) return;
    if (!picked.length) { imsg('IDFG has no matching layer for that choice (' + (info.layers || []).map(l => l.name).join(', ') + ').'); return; }
    map.addSource('idfg', { type: 'raster', tiles: [idfgTiles(svc, picked.map(l => l.id))], tileSize: 256, attribution: 'Idaho Fish and Game' });
    map.addLayer({ id: 'idfg', type: 'raster', source: 'idfg', paint: { 'raster-opacity': .6 } }, map.getLayer('wl') ? 'wl' : 'grid');
    imsg('Showing: ' + picked.map(l => l.name).join(', ') + '. Modeled habitat suitability from IDFG GPS collar data, not live animal positions.' + (sp === 'mule' ? ' IDFG labels the mule deer layers preliminary.' : ''));
  } catch (err) { if (tok === idfgToken) imsg('IDFG layer unavailable (' + (err.name === 'AbortError' ? 'timed out' : err.message) + ').'); }
  finally { clearTimeout(to); }
}
$('wlGo').onclick = run; $('wlClr').onclick = () => { clearWL(); };
['wlSp', 'wlSeason', 'wlWx', 'wlR', 'wlAhead', 'wlTime', 'wlLive', 'wlIdfg', 'wlHunt', 'wlHuman'].forEach(id => $(id).onchange = () => { save(); syncLive(); if (['wlSp', 'wlSeason', 'wlIdfg'].includes(id)) updateIdfg(); });
syncLive();
if ($('wlIdfg').value !== 'off') map.once('load', updateIdfg);
})(typeof window !== 'undefined' ? window : globalThis);
