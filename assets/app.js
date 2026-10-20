import { marked } from '../vendor/marked.esm.js';

/* ---------------- i18n ---------------- */
const UI = {
  en: { search: 'Search GPS-HKU…', openMap: '3D Map', prev: 'Previous', next: 'Next', onThisPage: 'On this page',
        edit: 'Edit this page on GitHub', noResults: 'No results', showOnMap: 'Show on map', notPinned: 'Not on map yet',
        floorPlans: 'Floor plans', noFloorPlans: 'No floor plans yet — see “About floor plans” to add them.',
        all: 'All', places: 'Places', pages: 'Pages', notFound: 'Page not found', notFoundText: 'This page does not exist yet.',
        mapNo: 'Map no.', updated: 'Unofficial student-made guide. Not affiliated with HKU.' },
  zh: { search: '搜尋 GPS-HKU…', openMap: '3D 地圖', prev: '上一頁', next: '下一頁', onThisPage: '本頁內容',
        edit: '在 GitHub 編輯此頁', noResults: '找不到結果', showOnMap: '在地圖顯示', notPinned: '尚未標示',
        floorPlans: '平面圖', noFloorPlans: '暫未有平面圖 — 請參閱「關於平面圖」加入。',
        all: '全部', places: '地點', pages: '頁面', notFound: '找不到頁面', notFoundText: '此頁面尚未建立。',
        mapNo: '地圖編號', updated: '學生自製非官方指南，與香港大學無關。' },
};
export const REPO = 'https://github.com/Icebays/gps-hku';

/* The page itself never zooms (pinch or double-tap): the 3D map and the floor plans have their own zoom.
   CSS touch-action covers most browsers; iOS Safari ignores user-scalable=no, so its pinch gesture
   events are cancelled too. */
for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
let lang = 'en';
try { lang = localStorage.getItem('gps-lang') || ((navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en'); } catch (e) {}
export const t = (k) => UI[lang][k] ?? k;
export const L = (o) => (o && (o[lang] || o.en)) || '';
export const getLang = () => lang;

/* ---------------- data ---------------- */
const cache = new Map();
async function getJSON(url) {
  if (!cache.has(url)) cache.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(url); return r.json(); }));
  return cache.get(url);
}
async function getText(url) {
  if (!cache.has(url)) cache.set(url, fetch(url).then((r) => (r.ok ? r.text() : null)));
  return cache.get(url);
}
export const loadPlaces = () => getJSON('data/places.json');
export const isPinned = (p) => p.buildings.length > 0 || !!p.at;
export const loadRoutes = () => getJSON('data/routes.json').catch(() => ({ routes: [] }));
let NAV = [];
const flatPages = () => NAV.flatMap((s) => s.pages.map((p) => ({ ...p, section: s.title })));

/* ---------------- dom refs ---------------- */
const $ = (s, el = document) => el.querySelector(s);
const sidebar = $('#sidebar'), page = $('#page'), toc = $('#toc');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export { esc };

/* ---------------- routing ---------------- */
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  let l = lang, id = 'index', anchor = null;
  if (parts[0] === 'en' || parts[0] === 'zh') { l = parts.shift(); }
  if (parts[0]) id = parts[0];
  if (parts[1]) anchor = parts[1];
  return { l, id, anchor, params: new URLSearchParams(qs || '') };
}
export const href = (id, params) => `#/${lang}/${id}${params ? '?' + new URLSearchParams(params) : ''}`;

let mapModule = null;
async function route() {
  const { l, id, anchor, params } = parseHash();
  if (l !== lang) { lang = l; try { localStorage.setItem('gps-lang', lang); } catch (e) {} }
  applyChrome();
  renderSidebar(id);
  document.body.classList.remove('nav-open');
  const meta = flatPages().find((p) => p.id === id);
  const isMap = id === 'map';
  document.body.classList.toggle('map-mode', isMap);
  if (!isMap && mapModule) mapModule.unmount();
  if (isMap) {
    toc.innerHTML = '';
    document.title = `${L(meta?.title) || 'Map'} · GPS-HKU`;
    mapModule = mapModule || (await import('./map.js'));
    await mapModule.mount(page, { lang, params });
    return;
  }
  if (id === 'buildings') return renderBuildings(meta, params);
  const md = await getText(`content/${lang}/${id}.md`) ?? (lang !== 'en' ? await getText(`content/en/${id}.md`) : null);
  if (md == null) {
    page.innerHTML = `<h1>${t('notFound')}</h1><p>${t('notFoundText')}</p><p><a href="${href('index')}">GPS-HKU</a></p>`;
    toc.innerHTML = ''; return;
  }
  page.innerHTML = renderMarkdown(md, meta) + pager(id) + pageFoot(id);
  document.title = `${L(meta?.title) || 'GPS-HKU'} · GPS-HKU`;
  buildToc();
  if (anchor) document.getElementById(anchor)?.scrollIntoView(); else window.scrollTo(0, 0);
}

/* ---------------- markdown ---------------- */
const slug = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
function renderMarkdown(md, meta) {
  const renderer = new marked.Renderer();
  renderer.heading = function ({ tokens, depth }) {
    const text = this.parser.parseInline(tokens);
    const id = slug(text);
    if (depth === 1) return `<h1>${text}</h1>`;
    return `<h${depth} id="${id}">${text}<a class="anchor" href="#/${lang}/${parseHash().id}/${id}">#</a></h${depth}>`;
  };
  renderer.code = ({ text, lang: info }) => {
    if (info === 'cards') {
      const items = text.trim().split('\n').map((ln) => ln.split('|').map((x) => x.trim()));
      return `<div class="cards">${items.map(([ico, title, desc, link]) =>
        `<a class="card" href="${fixHref(link)}"><span class="ico">${ico}</span><b>${esc(title)}</b><span>${esc(desc)}</span></a>`).join('')}</div>`;
    }
    return `<pre><code>${esc(text)}</code></pre>`;
  };
  renderer.link = function ({ href: h, title, tokens }) {
    const text = this.parser.parseInline(tokens);
    const ext = /^https?:/.test(h);
    return `<a href="${fixHref(h)}"${title ? ` title="${esc(title)}"` : ''}${ext ? ' target="_blank" rel="noopener"' : ''}>${text}</a>`;
  };
  renderer.blockquote = function ({ tokens }) {
    let body = this.parser.parse(tokens);
    let cls = '';
    body = body.replace(/^<p>\[!(NOTE|TIP|WARNING|CAUTION)\]\s*/i, (_, k) => { cls = /WARN|CAUTION/i.test(k) ? 'warn' : 'note'; return '<p>'; });
    return `<blockquote class="${cls}">${body}</blockquote>`;
  };
  const crumb = meta ? `<div class="crumb">${esc(L(meta.section))}</div>` : '';
  return crumb + marked.parse(md, { renderer, gfm: true });
}
function fixHref(h) {
  if (!h) return '#';
  if (/^(https?:|mailto:|#)/.test(h)) return h;
  if (/\.(png|jpe?g|pdf|json|glb|svg|webp)$/i.test(h.split('?')[0])) return h;
  return `#/${lang}/${h.replace(/^\.?\//, '').replace(/\.md$/, '')}`;
}
function buildToc() {
  const hs = [...page.querySelectorAll('h2, h3')];
  if (hs.length < 2) { toc.innerHTML = ''; return; }
  toc.innerHTML = `<h5>${t('onThisPage')}</h5>` + hs.map((h) =>
    `<a class="${h.tagName.toLowerCase()}" href="#/${lang}/${parseHash().id}/${h.id}" data-id="${h.id}">${esc(h.firstChild.textContent)}</a>`).join('');
  const links = [...toc.querySelectorAll('a')];
  const io = new IntersectionObserver((es) => {
    es.forEach((e) => { if (e.isIntersecting) links.forEach((a) => a.classList.toggle('active', a.dataset.id === e.target.id)); });
  }, { rootMargin: '-70px 0px -70% 0px' });
  hs.forEach((h) => io.observe(h));
}
function pager(id) {
  const list = flatPages();
  const i = list.findIndex((p) => p.id === id);
  if (i < 0) return '';
  const p = list[i - 1], n = list[i + 1];
  return `<nav class="pager">${p ? `<a class="prev" href="${href(p.id)}"><small>← ${t('prev')}</small>${esc(L(p.title))}</a>` : ''}${n ? `<a class="next" href="${href(n.id)}"><small>${t('next')} →</small>${esc(L(n.title))}</a>` : ''}</nav>`;
}
const pageFoot = (id) => `<div class="page-foot"><span>${t('updated')}</span><a href="${REPO}/blob/main/content/${lang}/${id}.md" target="_blank" rel="noopener">✎ ${t('edit')}</a></div>`;

/* ---------------- chrome ---------------- */
function applyChrome() {
  document.documentElement.lang = lang === 'zh' ? 'zh-Hant-HK' : 'en';
  $('#langBtn').textContent = lang === 'zh' ? 'EN' : '繁';
  document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => (el.placeholder = t(el.dataset.i18nPlaceholder)));
  $('.map-pill').href = href('map');
  $('.brand').href = href('index');
}
function renderSidebar(active) {
  sidebar.innerHTML = NAV.map((s) => `<h4>${esc(L(s.title))}</h4>` + s.pages.map((p) =>
    `<a href="${href(p.id)}" class="${p.id === active ? 'active' : ''}">${p.special === 'map' ? '🧭 ' : ''}${esc(L(p.title))}</a>`).join('')).join('') +
    `<div class="side-foot">3D data © Lands Department, HKSAR<br><a href="${REPO}" target="_blank" rel="noopener">GitHub</a></div>`;
}
$('#langBtn').addEventListener('click', () => {
  const { id, params } = parseHash();
  lang = lang === 'zh' ? 'en' : 'zh';
  try { localStorage.setItem('gps-lang', lang); } catch (e) {}
  searchIndex = null;
  location.hash = `#/${lang}/${id}${params.toString() ? '?' + params : ''}`;
});
$('#themeBtn').addEventListener('click', () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('gps-theme', root.dataset.theme); } catch (e) {}
  window.dispatchEvent(new Event('gps-theme'));
});
$('#menuBtn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
$('#scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));

/* ---------------- search ---------------- */
let searchIndex = null;
async function buildIndex() {
  const pages = flatPages().filter((p) => !p.special);
  const docs = await Promise.all(pages.map(async (p) => {
    const md = (await getText(`content/${lang}/${p.id}.md`)) || '';
    return { type: 'page', id: p.id, title: L(p.title), text: md.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`|\[\]()!-]/g, ' ').replace(/\s+/g, ' ') };
  }));
  const { places } = await loadPlaces();
  places.forEach((pl) => docs.push({ type: 'place', id: pl.id, title: L(pl.name), text: `${pl.name.en} ${pl.name.zh} ${L(pl.desc)} ${pl.no || ''}`, pinned: isPinned(pl) }));
  return docs;
}
const sInput = $('#searchInput'), sRes = $('#searchResults');
let sel = -1;
async function doSearch() {
  const q = sInput.value.trim().toLowerCase();
  if (!q) { sRes.hidden = true; return; }
  searchIndex = searchIndex || (await buildIndex());
  const terms = q.split(/\s+/);
  const hits = searchIndex.map((d) => {
    const ti = d.title.toLowerCase(), tx = d.text.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (ti.includes(term)) score += 10; else if (tx.includes(term)) score += 2; else return null;
    }
    if (d.type === 'place') score += 3;
    return { d, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 10);
  sel = -1;
  sRes.hidden = false;
  if (!hits.length) { sRes.innerHTML = `<div class="empty">${t('noResults')}</div>`; return; }
  sRes.innerHTML = hits.map(({ d }) => {
    if (d.type === 'place') {
      const link = d.pinned ? href('map', { place: d.id }) : href('buildings', { b: d.id });
      return `<a href="${link}">📍 ${esc(d.title)}<small>${t('places')}${d.pinned ? '' : ' · ' + t('notPinned')}</small></a>`;
    }
    const tx = d.text.toLowerCase(), i = tx.indexOf(terms[0]);
    const snip = i >= 0 ? '…' + d.text.slice(Math.max(0, i - 40), i + 80) + '…' : '';
    return `<a href="${href(d.id)}">📄 ${esc(d.title)}<small>${esc(snip)}</small></a>`;
  }).join('');
}
sInput.addEventListener('input', doSearch);
sInput.addEventListener('focus', doSearch);
sInput.addEventListener('keydown', (e) => {
  const items = [...sRes.querySelectorAll('a')];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items.forEach((a, i) => a.classList.toggle('active', i === sel));
  } else if (e.key === 'Enter' && items.length) { location.hash = items[Math.max(sel, 0)].getAttribute('href'); sInput.blur(); sRes.hidden = true; }
  else if (e.key === 'Escape') { sInput.blur(); sRes.hidden = true; }
});
document.addEventListener('click', (e) => { if (!e.target.closest('.search')) sRes.hidden = true; });
sRes.addEventListener('click', () => { sRes.hidden = true; sInput.value = ''; });
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); sInput.focus(); }
});

/* ---------------- building directory ---------------- */
async function renderBuildings(meta, params) {
  const data = await loadPlaces();
  const cats = data.categories;
  let filter = params.get('cat') || 'all';
  const intro = (await getText(`content/${lang}/buildings.md`)) || '';
  document.title = `${L(meta?.title)} · GPS-HKU`;
  const draw = () => {
    const list = data.places.filter((p) => filter === 'all' || p.cat === filter)
      .sort((a, b) => (parseInt(a.no) || 999) - (parseInt(b.no) || 999));
    page.innerHTML = renderMarkdown(intro, meta) +
      `<div class="filters"><button class="chip ${filter === 'all' ? 'on' : ''}" data-cat="all">${t('all')}</button>` +
      Object.entries(cats).map(([k, c]) => `<button class="chip ${filter === k ? 'on' : ''}" data-cat="${k}"><i class="dot" style="background:${c.color}"></i>${esc(L(c))}</button>`).join('') +
      `</div><div class="bldg-list">` + list.map((p) => {
        const other = lang === 'zh' ? p.name.en : p.name.zh;
        const pinned = isPinned(p);
        return `<div class="bldg" id="b-${p.id}">
          <span class="no" title="${t('mapNo')}">${esc(p.no || '–')}</span>
          <div><h3>${esc(L(p.name))}<small>${esc(other)}</small></h3><p>${esc(L(p.desc))}</p></div>
          <div class="acts">
            ${pinned ? `<a class="btn primary" href="${href('map', { place: p.id })}">📍 ${t('showOnMap')}</a>` : `<span class="tag">${t('notPinned')}</span>`}
            <button class="btn" data-fp="${p.id}">🗺 ${t('floorPlans')}${p.floors?.length ? ` (${p.floors.length})` : ''}</button>
          </div>
          <div class="floorplan" data-for="${p.id}" hidden></div>
        </div>`;
      }).join('') + `</div>` + pager('buildings') + pageFoot('buildings');
    page.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.cat; draw(); }));
    page.querySelectorAll('[data-fp]').forEach((b) => b.addEventListener('click', () => toggleFloorplan(data.places.find((p) => p.id === b.dataset.fp))));
    toc.innerHTML = '';
  };
  draw();
  const target = params.get('b');
  if (target) {
    const el = document.getElementById('b-' + target);
    if (el) { el.scrollIntoView({ block: 'center' }); el.style.borderColor = 'var(--accent)'; toggleFloorplan(data.places.find((p) => p.id === target)); }
  } else window.scrollTo(0, 0);
}
function toggleFloorplan(p) {
  const box = page.querySelector(`.floorplan[data-for="${p.id}"]`);
  box.hidden = !box.hidden;
  if (box.hidden || box.dataset.ready) return;
  box.dataset.ready = 1;
  if (!p.floors?.length) { box.innerHTML = `<div class="empty">${t('noFloorPlans')}</div>`; return; }
  box.innerHTML = `<div class="floor-tabs">${p.floors.map((f, i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-i="${i}">${esc(L(f.label) || f.label)}</button>`).join('')}</div><div class="stage"><img alt=""></div>`;
  const img = box.querySelector('img'), stage = box.querySelector('.stage');
  const pz = panZoom(stage, img);
  const show = (i) => { img.onload = () => pz.fit(); img.src = p.floors[i].src; box.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', +c.dataset.i === i)); };
  box.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => show(+c.dataset.i)));
  show(0);
}
function panZoom(stage, img) {
  let s = 1, x = 0, y = 0;
  const apply = () => (img.style.transform = `translate(${x}px,${y}px) scale(${s})`);
  const ptrs = new Map(); let last = null;
  const fit = () => { const r = stage.getBoundingClientRect(); s = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight); x = (r.width - img.naturalWidth * s) / 2; y = (r.height - img.naturalHeight * s) / 2; apply(); };
  const zoomAt = (f, cx, cy) => { const ns = Math.min(Math.max(s * f, 0.05), 20); x = cx - (cx - x) * (ns / s); y = cy - (cy - y) * (ns / s); s = ns; apply(); };
  stage.addEventListener('wheel', (e) => { e.preventDefault(); const r = stage.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  stage.addEventListener('pointerdown', (e) => { stage.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, e); last = null; });
  stage.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    const prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, e);
    if (ptrs.size === 1) { x += e.clientX - prev.clientX; y += e.clientY - prev.clientY; apply(); }
    else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const r = stage.getBoundingClientRect();
      if (last) zoomAt(d / last, (a.clientX + b.clientX) / 2 - r.left, (a.clientY + b.clientY) / 2 - r.top);
      last = d;
    }
  });
  const up = (e) => { ptrs.delete(e.pointerId); last = null; };
  stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
  stage.addEventListener('dblclick', fit);
  return { fit };
}

/* ---------------- boot ---------------- */
(async () => {
  NAV = await getJSON('content/nav.json');
  window.addEventListener('hashchange', route);
  if (!/^#\/(en|zh)\//.test(location.hash)) {
    const { id, params } = parseHash();
    history.replaceState(null, '', `#/${lang}/${id}${params.toString() ? '?' + params : ''}`);
  }
  route();
})();
