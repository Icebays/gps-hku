/* Current weather and Hong Kong Observatory warnings, bottom-left of the map (like Apple Maps).
   Data: HKO open data API (data.weather.gov.hk, CORS-enabled), fetched in the visitor's browser:
   rhrread (current temperature, weather icon, humidity) and warnsum (warnings in force).
   The warning icons are drawn here in the site's own style (rounded badge, white glyph).
   If the API cannot be reached the widget simply stays hidden. */

const API = 'https://data.weather.gov.hk/weatherAPI/opendata/weather.php';
// The weather shown is for HKU. HKO has no station on campus, so the temperature comes from the nearest
// station it reports (Hong Kong Park, ~2.6 km) - an HKU station is used first if HKO ever lists one.
const HKU_NAMES = ['The University of Hong Kong', 'University of Hong Kong', '香港大學', 'HKU'];
const STATIONS = [...HKU_NAMES, 'Hong Kong Park', '香港公園', 'Hong Kong Observatory', '天文台', '香港天文台', 'Wong Chuk Hang', '黃竹坑'];   // nearest to HKU first
const DISTRICT = ['Central & Western District', '中西區'];
const REFRESH = 10 * 60 * 1000;

/* ---------- weather icons (24 px, line style like the map tools) ---------- */
const CLOUD = 'M6.5 19h11a4.5 4.5 0 0 0 .6-8.96 6 6 0 0 0-11.5 1.6A3.7 3.7 0 0 0 6.5 19z';
const cloud = (dy = 0, fill = 'var(--bg)') => `<path d="${CLOUD}" transform="translate(0 ${dy})" fill="${fill}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>`;
const sun = (cx = 12, cy = 12, r = 4.2) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#f5b82e"/>` +
  Array.from({ length: 8 }, (_, i) => { const a = (i * Math.PI) / 4, c = Math.cos(a), s = Math.sin(a); return `<path d="M${(cx + c * (r + 2)).toFixed(1)} ${(cy + s * (r + 2)).toFixed(1)}L${(cx + c * (r + 4)).toFixed(1)} ${(cy + s * (r + 4)).toFixed(1)}" stroke="#f5b82e" stroke-width="1.8" stroke-linecap="round"/>`; }).join('');
const moon = (x = 0, y = 0) => `<path d="M${15 + x} ${4 + y}a7.5 7.5 0 1 0 5 12.5A8 8 0 0 1 ${15 + x} ${4 + y}z" fill="#f0c54b"/>`;
const drops = (n, col = '#3b82f6') => Array.from({ length: n }, (_, i) => { const x = 8 + i * (8 / Math.max(1, n - 1)); return `<path d="M${x} 19.5l-1 2.5" stroke="${col}" stroke-width="1.8" stroke-linecap="round"/>`; }).join('');
const svg = (body) => `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">${body}</svg>`;
const WX_ICON = {
  sun: svg(sun()),
  moon: svg(moon(-3, 0)),
  sunCloud: svg(sun(9, 8, 3.4) + cloud(1)),
  moonCloud: svg(moon(-6, -2) + cloud(1)),
  cloud: svg(cloud()),
  sunRain: svg(sun(9, 7, 3.2) + cloud(-2) + drops(3)),
  rain: svg(cloud(-2) + drops(3)),
  heavyRain: svg(cloud(-2) + drops(5)),
  thunder: svg(cloud(-3) + '<path d="M12.5 14.5l-2.5 4h3l-1.5 4.5" fill="none" stroke="#f5b82e" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>'),
  wind: svg('<path d="M3 9h11a3 3 0 1 0-3-3M3 14h15a3 3 0 1 1-3 3M3 19h7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
  fog: svg(cloud(-4) + '<path d="M4 18h16M6 21.5h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
  hot: svg('<path d="M10 14.2V5a2 2 0 1 1 4 0v9.2a4 4 0 1 1-4 0z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="17.5" r="2" fill="#ef4444"/><path d="M12 15.5V9" stroke="#ef4444" stroke-width="2" stroke-linecap="round"/>'),
  cold: svg('<path d="M10 14.2V5a2 2 0 1 1 4 0v9.2a4 4 0 1 1-4 0z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="17.5" r="2" fill="#38bdf8"/><path d="M12 15.5V13" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/>'),
  drop: svg('<path d="M12 3.5c3 4.2 5.5 7.3 5.5 10.5a5.5 5.5 0 0 1-11 0c0-3.2 2.5-6.3 5.5-10.5z" fill="none" stroke="#3b82f6" stroke-width="1.8"/>'),
};
// HKO weather icon numbers -> [icon, 中文, English, how clear the sky is (0..1, softens the shadows)]
const WX = {
  50: ['sun', '陽光充沛', 'Sunny', 1], 51: ['sunCloud', '間有陽光', 'Sunny periods', 0.85], 52: ['sunCloud', '短暫陽光', 'Sunny intervals', 0.7],
  53: ['sunRain', '間有陽光 幾陣驟雨', 'Sunny periods, a few showers', 0.6], 54: ['sunRain', '短暫陽光 有驟雨', 'Sunny intervals with showers', 0.5],
  60: ['cloud', '多雲', 'Cloudy', 0.35], 61: ['cloud', '密雲', 'Overcast', 0.15], 62: ['rain', '微雨', 'Light rain', 0.05], 63: ['rain', '雨', 'Rain', 0],
  64: ['heavyRain', '大雨', 'Heavy rain', 0], 65: ['thunder', '雷暴', 'Thunderstorms', 0],
  70: ['moon', '天色良好', 'Fine', 1], 71: ['moon', '天色良好', 'Fine', 1], 72: ['moon', '天色良好', 'Fine', 1], 73: ['moon', '天色良好', 'Fine', 1],
  74: ['moon', '天色良好', 'Fine', 1], 75: ['moon', '天色良好', 'Fine', 1], 76: ['moonCloud', '大致多雲', 'Mainly cloudy', 0.35], 77: ['moon', '天色大致良好', 'Mainly fine', 0.8],
  80: ['wind', '大風', 'Windy', 0.8], 81: ['sun', '乾燥', 'Dry', 1], 82: ['drop', '潮濕', 'Humid', 0.7], 83: ['fog', '霧', 'Fog', 0.3],
  84: ['fog', '薄霧', 'Mist', 0.4], 85: ['fog', '煙霞', 'Haze', 0.5], 90: ['hot', '熱', 'Hot', 1], 91: ['hot', '暖', 'Warm', 1],
  92: ['cold', '涼', 'Cool', 1], 93: ['cold', '冷', 'Cold', 1],
};

/* ---------- warning badges: rounded square, colour by warning, glyph in white (or dark on yellow) ---------- */
const G = {
  tc1: '<path d="M7 6.5h10M12 6.5v11" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
  tc3: '<path d="M12 6.5v11M7 17.5h10" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
  tc8: (deg) => `<path d="M14.5 3.2h6.3v6.3z" fill="currentColor" transform="rotate(${deg - 45} 12 12)"/><text x="11" y="17.6" font-size="14" font-weight="800" text-anchor="middle" fill="currentColor" font-family="system-ui,sans-serif">8</text>`,
  tc9: '<path d="M6.5 5h11L12 12zM12 12l5.5 7h-11z" fill="currentColor"/>',
  tc10: '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
  rain: '<path d="M7.6 13.5h8.6a3 3 0 0 0 .3-6 4 4 0 0 0-7.7 1A2.6 2.6 0 0 0 7.6 13.5z" fill="currentColor"/><path d="M8.5 16l-1 3M12 16l-1 3M15.5 16l-1 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  thunder: '<path d="M13.5 3.5L7 13h4.5l-1.5 7.5L17 11h-4.5z" fill="currentColor"/>',
  hot: '<path d="M10.2 13.6V6.2a1.8 1.8 0 1 1 3.6 0v7.4a3.6 3.6 0 1 1-3.6 0z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="16.6" r="1.8" fill="currentColor"/><path d="M12 15V9" stroke="currentColor" stroke-width="1.8"/><path d="M17 6.5h2.5M17 9.5h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  cold: '<path d="M12 4v16M5.1 8l13.8 8M5.1 16l13.8-8M10 5.5l2 2 2-2M10 18.5l2-2 2 2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  monsoon: '<path d="M7 20V4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M7.5 5h10l-3 4 3 4h-10z" fill="currentColor"/>',
  fire: '<path d="M12.5 3.5c.6 3.4 4.5 5 4.5 9.6A5 5 0 0 1 7 13.4c0-2.4 1.4-3.6 2-5.4 1.3 1 1.8 2.4 1.8 2.4s1.9-2.4 1.7-6.9z" fill="currentColor"/>',
  landslip: '<path d="M3.5 19.5L13 6l7.5 13.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="8" cy="12" r="1.6" fill="currentColor"/><circle cx="5.5" cy="15.5" r="1.3" fill="currentColor"/>',
  flood: '<path d="M7 11V7.5l5-3.5 5 3.5V11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M3.5 14.5q2.1-2 4.2 0t4.3 0 4.3 0 4.2 0M3.5 19q2.1-2 4.2 0t4.3 0 4.3 0 4.2 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  frost: '<path d="M12 3.5v11M7.2 6.2l9.6 5.6M7.2 11.8l9.6-5.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M4 17.5h16M6 20.5h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  tsunami: '<path d="M3 19c4.5 0 5.5-11 12-11 2.8 0 4 1.8 4 3.6-2-.9-4.3 0-4.3 2.4 0 2.6 3 4 6.3 4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  info: '<path d="M12 6.5v7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><circle cx="12" cy="17.5" r="1.5" fill="currentColor"/>',
};
const NAVY = '#1f4e79', RED = '#c62828', DARK = '#1b1f1d';
// code -> [glyph, background, glyph colour, 中文, English]
const WARN = {
  TC1: [G.tc1, NAVY, '#fff', '一號戒備信號', 'Standby Signal No. 1'],
  TC3: [G.tc3, NAVY, '#fff', '三號強風信號', 'Strong Wind Signal No. 3'],
  TC8NE: [G.tc8(45), RED, '#fff', '八號東北烈風或暴風信號', 'No. 8 Northeast Gale or Storm Signal'],
  TC8SE: [G.tc8(135), RED, '#fff', '八號東南烈風或暴風信號', 'No. 8 Southeast Gale or Storm Signal'],
  TC8SW: [G.tc8(225), RED, '#fff', '八號西南烈風或暴風信號', 'No. 8 Southwest Gale or Storm Signal'],
  TC8NW: [G.tc8(315), RED, '#fff', '八號西北烈風或暴風信號', 'No. 8 Northwest Gale or Storm Signal'],
  TC9: [G.tc9, RED, '#fff', '九號烈風或暴風風力增強信號', 'Increasing Gale or Storm Signal No. 9'],
  TC10: [G.tc10, RED, '#fff', '十號颶風信號', 'Hurricane Signal No. 10'],
  WRAINA: [G.rain, '#f2a20c', '#fff', '黃色暴雨警告信號', 'Amber Rainstorm Warning'],
  WRAINR: [G.rain, '#d62d2d', '#fff', '紅色暴雨警告信號', 'Red Rainstorm Warning'],
  WRAINB: [G.rain, DARK, '#fff', '黑色暴雨警告信號', 'Black Rainstorm Warning'],
  WTS: [G.thunder, '#f5c518', '#1b1f1d', '雷暴警告', 'Thunderstorm Warning'],
  WHOT: [G.hot, '#e8590c', '#fff', '酷熱天氣警告', 'Very Hot Weather Warning'],
  WCOLD: [G.cold, '#1d7fc4', '#fff', '寒冷天氣警告', 'Cold Weather Warning'],
  WMSGNL: [G.monsoon, '#37474f', '#fff', '強烈季候風信號', 'Strong Monsoon Signal'],
  WFIREY: [G.fire, '#f5c518', '#1b1f1d', '黃色火災危險警告', 'Yellow Fire Danger Warning'],
  WFIRER: [G.fire, '#d62d2d', '#fff', '紅色火災危險警告', 'Red Fire Danger Warning'],
  WL: [G.landslip, '#8d5524', '#fff', '山泥傾瀉警告', 'Landslip Warning'],
  WFNTSA: [G.flood, '#0b6fa4', '#fff', '新界北部水浸特別報告', 'Flooding in the northern New Territories'],
  WFROST: [G.frost, '#7cc6e8', '#0d3346', '霜凍警告', 'Frost Warning'],
  WTMW: [G.tsunami, '#1e3a8a', '#fff', '海嘯警告', 'Tsunami Warning'],
};
export function warnBadge(code, size = 26) {
  const [g, bg, fg] = WARN[code] || [G.info, '#5b6660', '#fff'];
  return `<svg class="wx-badge" viewBox="0 0 24 24" width="${size}" height="${size}" style="color:${fg};--wb:${bg}" aria-hidden="true"><rect x=".5" y=".5" width="23" height="23" rx="6" fill="${bg}" stroke="rgba(255,255,255,.35)"/>${g}</svg>`;
}

const get = (type, lang) => fetch(`${API}?dataType=${type}&lang=${lang}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))));
const pick = (list, names) => { for (const n of names) { const d = list?.find((x) => x.place === n); if (d) return d; } return list?.[0]; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/* Mount the widget into the map; onSky(clear 0..1) is told how clear the sky is (for the sun's shadows). */
export function mountWeather(wrap, { lang = 'zh', onSky } = {}) {
  const zh = lang !== 'en', api = zh ? 'tc' : 'en';
  wrap.querySelector('.map-weather')?.remove();
  const el = document.createElement('div');
  el.className = 'map-ui map-weather';
  el.hidden = true;
  wrap.appendChild(el);
  let open = false, data = null;
  const render = () => {
    if (!data) return;
    const { now, warn } = data;
    const code = now.icon?.[0], wx = WX[code] || ['cloud', '', '', 1];
    const t = pick(now.temperature?.data, STATIONS), h = pick(now.humidity?.data, STATIONS);
    const rain = pick(now.rainfall?.data, DISTRICT);
    const warns = Object.values(warn || {}).filter((w) => w && w.code && w.actionCode !== 'CANCEL');
    const name = (w) => (WARN[w.code] ? WARN[w.code][zh ? 3 : 4] : w.name || w.code);
    const time = new Date(now.updateTime || now.temperature?.recordTime || Date.now()).toLocaleTimeString(zh ? 'zh-HK' : 'en-HK', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Hong_Kong' });
    el.innerHTML = `<button class="wx-now" aria-expanded="${open}" title="${zh ? '香港大學' : 'HKU'} · ${esc(wx[zh ? 1 : 2])}">
        <span class="wx-ico">${WX_ICON[wx[0]]}</span><b class="wx-temp">${t ? Math.round(t.value) + '°' : '–'}</b>
        ${warns.length ? `<span class="wx-warns">${warns.map((w) => warnBadge(w.code, 24)).join('')}</span>` : ''}
      </button>
      <div class="wx-more"${open ? '' : ' hidden'}>
        <div class="wx-cond">${zh ? '香港大學' : 'HKU'} · ${esc(wx[zh ? 1 : 2])}</div>
        <div class="wx-meta">${[h ? `${zh ? '濕度' : 'Humidity'} ${h.value}%` : '', rain ? `${zh ? '中西區雨量' : 'Rain (Central & Western)'} ${rain.max} mm` : ''].filter(Boolean).join(' · ')}</div>
        ${t && !HKU_NAMES.includes(t.place) ? `<div class="wx-meta">${zh ? `氣溫：最近嘅氣象站（${esc(t.place)}）` : `Temperature: nearest station (${esc(t.place)})`}</div>` : ''}
        ${warns.map((w) => `<div class="wx-warn">${warnBadge(w.code, 22)}<span>${esc(name(w))}</span></div>`).join('')}
        <a class="wx-src" href="https://www.hko.gov.hk/${zh ? 'tc' : 'en'}/wxinfo/currwx/current.htm" target="_blank" rel="noopener">${zh ? '香港天文台' : 'Hong Kong Observatory'} · ${time}</a>
      </div>`;
    el.hidden = false;
    onSky?.(wx[3]);
  };
  el.addEventListener('click', (e) => {
    if (!e.target.closest('.wx-now')) return;
    open = !open; render();
  });
  const load = () => Promise.all([get('rhrread', api), get('warnsum', api).catch(() => ({}))])
    .then(([now, warn]) => { data = { now, warn }; render(); })
    .catch((e) => { console.info('weather unavailable', e.message); if (!data) el.hidden = true; });
  load();
  const timer = setInterval(load, REFRESH);
  return { el, stop: () => { clearInterval(timer); el.remove(); } };
}
