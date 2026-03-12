/* ════════════════════════════════════════════════════════
   MEDIA EXPLORER — app.js
   ════════════════════════════════════════════════════════ */

// ── Stop words (Russian + common English) ─────────────────
const STOP = new Set([
  'и','в','не','что','на','с','он','как','а','по','из','за','к','для',
  'это','от','но','все','о','об','или','его','её','их','то','так','же',
  'бы','ли','было','будет','быть','при','до','уже','ещё','еще','если',
  'тем','нет','я','ты','мы','вы','они','она','оно','нам','вам','им',
  'нас','вас','них','кто','где','когда','почему','который','которая',
  'которые','этот','этого','этой','этому','эту','этим','этих','эти',
  'своей','своих','свое','свои','свой','свою','своего','своему','только',
  'также','тоже','даже','вот','вся','всё','всего','был','была','были',
  'the','a','an','of','to','in','is','it','and','or','for','with','that',
  'this','are','was','were','be','been','has','have','had','not','than',
  'чем','там','тут','хотя','пока','либо','чтобы','тогда','здесь',
  'между','более','после','перед','через','очень','можно','нельзя',
  'надо','нужно','такой','такая','такое','такие','есть','меня','тебя',
  'него','неё','мне','тебе','ему','ей',
]);

// ── Transliteration map (longest match first) ─────────────
const TRANSLIT = [
  ['shch','щ'],['sch','щ'],
  ['zh','ж'],['sh','ш'],['ch','ч'],['ts','ц'],['kh','х'],
  ['ya','я'],['yu','ю'],['yo','ё'],['ye','е'],
  ['a','а'],['b','б'],['c','с'],['d','д'],['e','е'],['f','ф'],
  ['g','г'],['h','х'],['i','и'],['j','й'],['k','к'],['l','л'],
  ['m','м'],['n','н'],['o','о'],['p','п'],['q','к'],['r','р'],
  ['s','с'],['t','т'],['u','у'],['v','в'],['w','в'],['x','кс'],
  ['y','й'],['z','з'],
];

function transliterate(text) {
  let result = '';
  let i = 0;
  const lower = text.toLowerCase();
  while (i < lower.length) {
    let matched = false;
    for (const [lat, cyr] of TRANSLIT) {
      if (lower.startsWith(lat, i)) {
        result += cyr;
        i += lat.length;
        matched = true;
        break;
      }
    }
    if (!matched) { result += text[i]; i++; }
  }
  return result;
}

// ── Non-reactive data store (keeps 47k objects outside Alpine's proxy) ──
window.POSTS = [];

// ── Alpine component ──────────────────────────────────────
function app() {
  return {

    // ─ Theme ──────────────────────────────────────────────
    theme: 'dark',

    // ─ Load state ─────────────────────────────────────────
    loaded:       false,
    loading:      false,
    loadProgress: 0,
    loadedCount:  0,
    loadingMsg:   'Loading…',
    totalCount:   0,

    // ─ Filters ────────────────────────────────────────────
    channelFilter:   '',
    platformFilters: [],   // [] = all; array of selected platforms
    dateStart:      '',
    dateEnd:        '',
    keyword:        '',
    textOnly:       false,

    // ─ Sort ───────────────────────────────────────────────
    sortBy:   'published_at',
    sortDir:  'desc',
    sortOptions: [
      ['published_at', 'Date'],
      ['ViewsCount',   'Views'],
      ['LikesCount',   'Likes'],
      ['SharesCount',  'Shares'],
      ['CommentsCount','Comments'],
    ],

    // ─ Pagination ─────────────────────────────────────────
    page:     1,
    pageSize: 50,

    // ─ Timeline chart ─────────────────────────────────────
    timelineOpen:   false,
    timelineBucket: '',
    _timelineChart: null,

    // ─ Domains chart ──────────────────────────────────────
    domainsOpen:   false,
    domainsHeight: 320,
    _domainsChart: null,

    // ─ Trending chart ─────────────────────────────────────
    trendingOpen:  false,
    trendingMode: 'keywords',
    trendingEmpty: true,
    chartHeight:   320,
    _chart:        null,

    // ─ Modal ──────────────────────────────────────────────
    modalPost: null,

    // ─ Computed caches (updated explicitly by applyFilters) ─
    filteredCount:    0,
    _filtered:        [],
    channelList:      [],
    channelBreakdown: [],
    dateRangeLabel:   '',
    pageRows:         [],
    totalPages:       1,

    // ══ Lifecycle ═════════════════════════════════════════
    init() {
      // Restore theme
      const saved = localStorage.getItem('me-theme');
      if (saved === 'light') {
        this.theme = 'light';
        document.documentElement.classList.add('light');
      }

      // Watch every filter field → refilter + rebuild open charts
      ['channelFilter','dateStart','dateEnd',
       'keyword','textOnly','sortBy','sortDir'].forEach(f => {
        this.$watch(f, () => {
          this.page = 1;
          this.applyFilters();
          this.$nextTick(() => {
            if (this.timelineOpen) this.buildTimelineChart();
            if (this.domainsOpen)  this.buildDomainsChart();
            if (this.trendingOpen) this.buildChart();
          });
        });
      });

      this.$watch('page', () => this.buildPage());

      // Rebuild charts if theme changes (colours differ per theme)
      this.$watch('theme', () => {
        this.$nextTick(() => {
          if (this.timelineOpen) this.buildTimelineChart();
          if (this.domainsOpen)  this.buildDomainsChart();
          if (this.trendingOpen) this.buildChart();
        });
      });
    },

    // ══ Theme toggle ══════════════════════════════════════
    toggleTheme() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.classList.toggle('light', this.theme === 'light');
      localStorage.setItem('me-theme', this.theme);
    },

    // ══ Auto-load ═════════════════════════════════════════
    async tryAutoLoad() {
      this.loading    = true;
      this.loadingMsg = 'Downloading CSV…';
      this.loadProgress = 5;
      try {
        const res = await fetch('./posts_1772115035.csv');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const file = new File([blob], 'posts_1772115035.csv', { type: 'text/csv' });
        this.loadingMsg   = 'Parsing CSV…';
        this.loadProgress = 0;
        this.loadFile(file);
      } catch (e) {
        console.error('Auto-load failed:', e.message);
        this.loading = false;
      }
    },

    // ══ File handling ═════════════════════════════════════
    handleDrop(e) {
      document.querySelectorAll('.drop-zone').forEach(el => el.classList.remove('dragging'));
      const file = e.dataTransfer?.files?.[0];
      if (file) this.loadFile(file);
    },
    handleFileInput(e) {
      const file = e.target?.files?.[0];
      if (file) this.loadFile(file);
      e.target.value = '';
    },

    loadFile(file) {
      this.loading      = true;
      this.loaded       = false;
      this.loadedCount  = 0;
      window.POSTS      = [];
      const size = file.size;

      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        chunk: (results) => {
          for (const row of results.data) {
            if (!row.PostId) continue;
            row._ts    = row.published_at ? new Date(row.published_at).getTime() : 0;
            row._text  = (row.post_body_text || '').toLowerCase();
            row._hasT  = row._text.trim().length > 0;
            row._views = parseInt(row.ViewsCount)    || 0;
            row._likes = parseInt(row.LikesCount)    || 0;
            row._shr   = parseInt(row.SharesCount)   || 0;
            row._cmts  = parseInt(row.CommentsCount) || 0;
            window.POSTS.push(row);
          }
          this.loadedCount  = window.POSTS.length;
          this.loadProgress = Math.min(99, Math.round((results.meta.cursor / size) * 100));
        },
        complete: () => {
          this.totalCount   = window.POSTS.length;
          this.loadProgress = 100;
          this.channelList  = this._mkChannelList(window.POSTS);
          this.loaded       = true;
          this.applyFilters();
          this.$nextTick(() => { this.loading = false; });
        },
        error: (err) => {
          console.error('CSV parse error:', err);
          this.loading = false;
        },
      });
    },

    // ══ Filtering & sorting ═══════════════════════════════
    applyFilters() {
      let posts = window.POSTS;

      if (this.channelFilter) {
        const ch = this.channelFilter;
        posts = posts.filter(p => p.ChannelName === ch);
      }
      if (this.platformFilters.length) {
        const pf = this.platformFilters;
        posts = posts.filter(p => pf.includes(p.Platform));
      }
      if (this.dateStart) {
        const t = new Date(this.dateStart).getTime();
        posts = posts.filter(p => p._ts >= t);
      }
      if (this.dateEnd) {
        const t = new Date(this.dateEnd + 'T23:59:59Z').getTime();
        posts = posts.filter(p => p._ts <= t);
      }
      if (this.keyword) {
        const kw = this.keyword.toLowerCase();
        posts = posts.filter(p => p._text.includes(kw));
      }
      if (this.textOnly) {
        posts = posts.filter(p => p._hasT);
      }

      const field = this.sortBy;
      const dir   = this.sortDir === 'desc' ? -1 : 1;
      posts = [...posts].sort((a, b) => dir * (this._val(b, field) - this._val(a, field)));

      this._filtered        = posts;
      this.filteredCount    = posts.length;
      this.channelBreakdown = this._mkChannelList(posts);
      this.dateRangeLabel   = this._mkDateRange(posts);
      this.totalPages       = Math.max(1, Math.ceil(posts.length / this.pageSize));
      this.buildPage();
    },

    buildPage() {
      const s       = (this.page - 1) * this.pageSize;
      this.pageRows = this._filtered.slice(s, s + this.pageSize);
    },

    // ══ Timeline chart ════════════════════════════════════
    toggleTimeline() {
      this.timelineOpen = !this.timelineOpen;
      if (this.timelineOpen) this.$nextTick(() => this.buildTimelineChart());
    },

    buildTimelineChart() {
      const self  = this;           // explicit reference — safe in Chart.js callbacks
      const posts = this._filtered;

      if (!posts.length) {
        if (self._timelineChart) { self._timelineChart.destroy(); self._timelineChart = null; }
        return;
      }

      let mn = Infinity, mx = -Infinity;
      for (const p of posts) {
        if (p._ts && p._ts < mn) mn = p._ts;
        if (p._ts && p._ts > mx) mx = p._ts;
      }
      if (!isFinite(mn)) return;

      const DAY   = 86400000;
      const range = mx - mn;

      let bucketMs, labelFmt, bucketLabel;
      if (range <= 2 * DAY) {
        bucketMs    = 3600000;             // 1 h
        bucketLabel = '· hourly';
        labelFmt    = ts => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      } else if (range <= 14 * DAY) {
        bucketMs    = 6 * 3600000;         // 6 h
        bucketLabel = '· 6-hour';
        labelFmt    = ts => {
          const d = new Date(ts);
          return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
               + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        };
      } else if (range <= 180 * DAY) {
        bucketMs    = DAY;                 // daily
        bucketLabel = '· daily';
        labelFmt    = ts => new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      } else if (range <= 2 * 365 * DAY) {
        bucketMs    = 7 * DAY;             // weekly
        bucketLabel = '· weekly';
        labelFmt    = ts => new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
      } else {
        bucketMs    = 30 * DAY;            // monthly
        bucketLabel = '· monthly';
        labelFmt    = ts => new Date(ts).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
      }

      self.timelineBucket = bucketLabel;

      // Count posts per bucket
      const buckets = {};
      for (const p of posts) {
        if (!p._ts) continue;
        const b = Math.floor(p._ts / bucketMs) * bucketMs;
        buckets[b] = (buckets[b] || 0) + 1;
      }

      const firstB = Math.floor(mn / bucketMs) * bucketMs;
      const lastB  = Math.floor(mx / bucketMs) * bucketMs;
      const labels = [], counts = [];
      for (let t = firstB; t <= lastB; t += bucketMs) {
        labels.push(labelFmt(t));
        counts.push(buckets[t] || 0);
      }

      const light  = self.theme === 'light';
      const lineC  = light ? '#0891b2'                : '#22d3ee';
      const fillC  = light ? 'rgba(8,145,178,0.1)'   : 'rgba(34,211,238,0.08)';
      const grid   = light ? 'rgba(0,0,0,0.06)'      : 'rgba(255,255,255,0.04)';
      const tick   = light ? '#6b7280'                : '#475569';

      self.$nextTick(() => {
        const canvas = document.getElementById('timelineChart');
        if (!canvas) return;
        const existingT = Chart.getChart(canvas);
        if (existingT) existingT.destroy();

        self._timelineChart = new Chart(canvas.getContext('2d'), {
          type: 'line',
          data: {
            labels,
            datasets: [{
              data: counts,
              borderColor:     lineC,
              backgroundColor: fillC,
              borderWidth: 1.5,
              pointRadius:      labels.length > 60 ? 0 : 2,
              pointHoverRadius: 4,
              fill: true,
              tension: 0.35,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 150 },
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: { label: ctx => ` ${ctx.raw.toLocaleString()} posts` } },
            },
            scales: {
              x: {
                grid:  { color: grid },
                ticks: { color: tick, font: { size: 10 }, maxTicksLimit: 14, maxRotation: 45 },
              },
              y: {
                grid:       { color: grid },
                ticks:      { color: tick, font: { size: 10 } },
                beginAtZero: true,
              },
            },
          },
        });
      });
    },

    // ══ Domains chart ═════════════════════════════════════
    toggleDomains() {
      this.domainsOpen = !this.domainsOpen;
      if (this.domainsOpen) this.$nextTick(() => this.buildDomainsChart());
    },

    buildDomainsChart() {
      const self = this;
      const DOMAIN_RE = /https?:\/\/(?:www\.)?([a-z0-9][a-z0-9\-\.]+\.[a-z]{2,}(?:\.[a-z]{2,})?)/g;
      const freq = {};

      for (const p of this._filtered) {
        const text = p._text;
        DOMAIN_RE.lastIndex = 0;
        const seen = new Set();
        let m;
        while ((m = DOMAIN_RE.exec(text)) !== null) {
          const d = m[1];
          if (!seen.has(d)) {
            seen.add(d);
            freq[d] = (freq[d] || 0) + 1;
          }
        }
      }

      const entries = Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20);

      if (!entries.length) {
        if (self._domainsChart) { self._domainsChart.destroy(); self._domainsChart = null; }
        return;
      }

      const labels = entries.map(([k]) => k);
      const counts = entries.map(([, v]) => v);
      self.domainsHeight = Math.max(220, entries.length * 24);

      const light = self.theme === 'light';
      const barBg = light ? 'rgba(139,92,246,0.18)' : 'rgba(167,139,250,0.2)';
      const barBd = light ? 'rgba(139,92,246,0.7)'  : 'rgba(167,139,250,0.65)';
      const grid  = light ? 'rgba(0,0,0,0.06)'      : 'rgba(255,255,255,0.04)';
      const tickX = light ? '#6b7280'                : '#475569';
      const tickY = light ? '#374151'                : '#94a3b8';

      self.$nextTick(() => {
        const canvas = document.getElementById('domainsChart');
        if (!canvas) return;
        const existingD = Chart.getChart(canvas);
        if (existingD) existingD.destroy();

        self._domainsChart = new Chart(canvas.getContext('2d'), {
          type: 'bar',
          data: {
            labels,
            datasets: [{
              data: counts,
              backgroundColor: barBg,
              borderColor:     barBd,
              borderWidth: 1,
              borderRadius: 3,
            }],
          },
          options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 150 },
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: { label: ctx => ` ${ctx.raw.toLocaleString()} posts` } },
            },
            scales: {
              x: { grid: { color: grid }, ticks: { color: tickX, font: { size: 11 } } },
              y: {
                grid: { display: false },
                ticks: {
                  color: tickY,
                  font:  { size: 11 },
                  callback: (_, idx) => {
                    const l = labels[idx] || '';
                    return l.length > 32 ? l.slice(0, 32) + '…' : l;
                  },
                },
              },
            },
            onClick: (_, els) => {
              if (!els.length) return;
              self.keyword = labels[els[0].index];
              self.page    = 1;
            },
          },
        });
      });
    },

    // ══ Trending chart ════════════════════════════════════
    toggleTrending() {
      this.trendingOpen = !this.trendingOpen;
      if (this.trendingOpen) this.$nextTick(() => this.buildChart());
    },

    // Called from mode toggle buttons — avoids multi-statement @click expression parsing issues
    setTrendingMode(mode) {
      this.trendingMode = mode;
      if (this.trendingOpen) this.$nextTick(() => this.buildChart());
    },

    buildChart() {
      const self   = this;           // explicit reference — safe in Chart.js callbacks
      const sample = this._filtered.slice(0, 5000);
      const freq   = {};

      if (self.trendingMode === 'hashtags') {
        for (const p of sample) {
          const ms = p._text.match(/#[\wа-яёa-z]+/g) || [];
          for (const t of ms) freq[t] = (freq[t] || 0) + 1;
        }
      } else {
        for (const p of sample) {
          const ws = p._text
            .replace(/[^\wа-яё\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 3 && !STOP.has(w));
          for (const w of ws) freq[w] = (freq[w] || 0) + 1;
        }
      }

      const entries = Object.entries(freq)
        .filter(([, c]) => c > 1)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25);

      self.trendingEmpty = entries.length === 0;
      if (self.trendingEmpty) {
        if (self._chart) { self._chart.destroy(); self._chart = null; }
        return;
      }

      const labels = entries.map(([k]) => k);
      const counts = entries.map(([, v]) => v);
      self.chartHeight = Math.max(220, entries.length * 24);

      const light = self.theme === 'light';
      const barBg = light ? 'rgba(8,145,178,0.18)'  : 'rgba(34,211,238,0.2)';
      const barBd = light ? 'rgba(8,145,178,0.7)'   : 'rgba(34,211,238,0.65)';
      const grid  = light ? 'rgba(0,0,0,0.06)'      : 'rgba(255,255,255,0.04)';
      const tickX = light ? '#6b7280'                : '#475569';
      const tickY = light ? '#374151'                : '#94a3b8';

      self.$nextTick(() => {
        const canvas = document.getElementById('trendChart');
        if (!canvas) return;
        const existingC = Chart.getChart(canvas);
        if (existingC) existingC.destroy();

        self._chart = new Chart(canvas.getContext('2d'), {
          type: 'bar',
          data: {
            labels,
            datasets: [{
              data: counts,
              backgroundColor: barBg,
              borderColor:     barBd,
              borderWidth: 1,
              borderRadius: 3,
            }],
          },
          options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 150 },
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: { label: ctx => ` ${ctx.raw.toLocaleString()} posts` } },
            },
            scales: {
              x: { grid: { color: grid }, ticks: { color: tickX, font: { size: 11 } } },
              y: {
                grid: { display: false },
                ticks: {
                  color: tickY,
                  font:  { size: 11 },
                  callback: (_, idx) => {
                    const l = labels[idx] || '';
                    return l.length > 28 ? l.slice(0, 28) + '…' : l;
                  },
                },
              },
            },
            // Use self (explicit ref) to ensure Alpine reactivity is triggered correctly
            onClick: (_, els) => {
              if (!els.length) return;
              self.keyword = labels[els[0].index].replace(/^#/, '');
              self.page    = 1;
            },
          },
        });
      });
    },

    // ══ Actions ═══════════════════════════════════════════
    toggleSort(field) {
      if (this.sortBy === field) this.sortDir = this.sortDir === 'desc' ? 'asc' : 'desc';
      else { this.sortBy = field; this.sortDir = 'desc'; }
      this.page = 1;
    },

    resetFilters() {
      this.channelFilter   = '';
      this.platformFilters = [];
      this.dateStart      = '';
      this.dateEnd        = '';
      this.keyword        = '';
      this.textOnly       = false;
      this.page           = 1;
    },

    togglePlatform(p) {
      if (p === 'All') {
        this.platformFilters = [];
      } else if (this.platformFilters.includes(p)) {
        this.platformFilters = this.platformFilters.filter(x => x !== p);
      } else {
        this.platformFilters = [...this.platformFilters, p];
      }
      this.page = 1;
      this.applyFilters();
      this.$nextTick(() => {
        if (this.timelineOpen) this.buildTimelineChart();
        if (this.domainsOpen)  this.buildDomainsChart();
        if (this.trendingOpen) this.buildChart();
      });
    },

    openModal(post) { this.modalPost = post; },

    applyTranslit() {
      if (this.keyword) this.keyword = transliterate(this.keyword);
    },

    // ══ Helpers ═══════════════════════════════════════════
    hasLatin(text) { return text && /[a-zA-Z]/.test(text); },

    formatDate(iso) {
      if (!iso) return '—';
      const d = new Date(iso);
      if (isNaN(d)) return iso;
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
           + ' '
           + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    },

    trunc(t, n) {
      if (!t) return '';
      t = t.trim();
      return t.length > n ? t.slice(0, n) + '…' : t;
    },

    fmtNum(v) {
      const n = parseInt(v) || 0;
      if (n === 0) return '—';
      if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
      if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
      return n.toLocaleString();
    },

    _val(p, field) {
      if (field === 'published_at') return p._ts;
      if (field === 'ViewsCount')   return p._views;
      if (field === 'LikesCount')   return p._likes;
      if (field === 'SharesCount')  return p._shr;
      return p._cmts;
    },

    _mkChannelList(posts) {
      const map = {};
      for (const p of posts)
        if (p.ChannelName) map[p.ChannelName] = (map[p.ChannelName] || 0) + 1;
      return Object.entries(map)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count }));
    },

    _mkDateRange(posts) {
      if (!posts.length) return '';
      let mn = Infinity, mx = -Infinity;
      for (const p of posts) {
        if (p._ts && p._ts < mn) mn = p._ts;
        if (p._ts && p._ts > mx) mx = p._ts;
      }
      if (!isFinite(mn)) return '';
      const fmt = ts => new Date(ts).toLocaleDateString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
      });
      return mn === mx ? fmt(mn) : `${fmt(mn)} → ${fmt(mx)}`;
    },

    get pageButtons() {
      const T = this.totalPages, C = this.page;
      if (T <= 7) return Array.from({ length: T }, (_, i) => i + 1);
      const p = [];
      if (C > 3) { p.push(1); if (C > 4) p.push('…'); }
      for (let i = Math.max(1, C - 2); i <= Math.min(T, C + 2); i++) p.push(i);
      if (C < T - 2) { if (C < T - 3) p.push('…'); p.push(T); }
      return p;
    },
  };
}
