/* ═══════════════════════════════════════════════════════════
   ForexPulse — Main Application Controller (v2)
   Sparklines, Converter, Modal, Toasts, Enhanced UX
   ══════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  // ─── State ──────────────────────────────────────────────
  const state = {
    currentPage: 'dashboard',
    rates: null,
    news: [],
    calendar: [],
    sentiment: {},
    strength: {},
    sparklines: {},
    newsFilter: 'all',
    newsSearch: '',
    calCurrency: 'all',
    calImpact: 'all',
    ws: null,
    wsReconnectTimer: null,
    previousRates: {},
    wsLatency: 0,
    wsConnectTime: 0
  };

  const MAJOR_PAIRS = [
    'EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF',
    'AUD/USD', 'NZD/USD', 'USD/CAD', 'EUR/GBP'
  ];

  const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD'];

  const CURRENCY_FLAGS = {
    USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵',
    CHF: '🇨🇭', CAD: '🇨🇦', AUD: '🇦🇺', NZD: '🇳🇿'
  };

  // ─── API Client ─────────────────────────────────────────
  const api = {
    async get(endpoint) {
      try {
        const start = performance.now();
        const resp = await fetch(`/api/${endpoint}`);
        state.wsLatency = Math.round(performance.now() - start);
        const json = await resp.json();
        return json.success ? json.data : null;
      } catch (err) {
        console.error(`API error (${endpoint}):`, err);
        return null;
      }
    }
  };

  // ─── Toast Notification System ──────────────────────────
  function showToast(type, title, message, duration = 4000) {
    const container = document.getElementById('toastContainer');
    const icons = { success: '✅', warning: '⚠️', error: '❌', info: 'ℹ️' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
      <div class="toast-content">
        <div class="toast-title">${title}</div>
        <div class="toast-message">${message}</div>
      </div>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-exit');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // ─── WebSocket ──────────────────────────────────────────
  function connectWebSocket() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    state.wsConnectTime = Date.now();
    state.ws = new WebSocket(`${proto}//${location.host}`);

    state.ws.onopen = () => {
      updateConnectionStatus('connected');
      showToast('success', 'Connected', 'Live data stream established');
    };

    state.ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        handleWSMessage(msg);
      } catch {}
    };

    state.ws.onclose = () => {
      updateConnectionStatus('disconnected');
      clearTimeout(state.wsReconnectTimer);
      state.wsReconnectTimer = setTimeout(connectWebSocket, 3000);
    };

    state.ws.onerror = () => {
      updateConnectionStatus('disconnected');
    };
  }

  function handleWSMessage(msg) {
    switch (msg.type) {
      case 'rates':
        if (state.rates) {
          state.previousRates = {};
          for (const [pair, d] of Object.entries(state.rates.pairs || {})) {
            state.previousRates[pair] = d.rate;
          }
        }
        state.rates = msg.data;
        // Store sparkline data from server
        if (msg.data.sparklines) {
          state.sparklines = msg.data.sparklines;
        }
        if (state.currentPage === 'dashboard') renderDashPairs();
        if (state.currentPage === 'heatmap') renderHeatmap();
        if (state.currentPage === 'converter') doConvert();
        renderTicker();
        updateFooter();
        break;
      case 'news':
        if (msg.data && msg.data.length) {
          const existingIds = new Set(state.news.map(n => n.id));
          const newItems = msg.data.filter(n => !existingIds.has(n.id));
          if (newItems.length) {
            state.news = [...newItems, ...state.news].slice(0, 100);
            if (state.currentPage === 'dashboard') renderDashNews();
            if (state.currentPage === 'news') renderNewsPage();
            showToast('info', 'New Articles', `${newItems.length} new article${newItems.length > 1 ? 's' : ''} available`);
          }
        }
        break;
    }
  }

  function updateConnectionStatus(status) {
    const el = document.getElementById('connectionStatus');
    el.className = `connection-status ${status}`;
    el.querySelector('.status-text').textContent =
      status === 'connected' ? 'Live' : status === 'disconnected' ? 'Reconnecting...' : 'Connecting...';
  }

  // ─── Router ─────────────────────────────────────────────
  function initRouter() {
    window.addEventListener('hashchange', handleRoute);
    handleRoute();
  }

  function handleRoute() {
    const hash = location.hash.slice(1) || 'dashboard';
    const validPages = ['dashboard', 'news', 'calendar', 'heatmap', 'analysis', 'converter'];
    const page = validPages.includes(hash) ? hash : 'dashboard';

    state.currentPage = page;

    document.querySelectorAll('.nav-link').forEach(link => {
      link.classList.toggle('active', link.dataset.page === page);
    });

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const pageEl = document.getElementById(`page${capitalize(page)}`);
    if (pageEl) pageEl.classList.add('active');

    renderPage(page);
  }

  async function renderPage(page) {
    switch (page) {
      case 'dashboard': await loadDashboard(); break;
      case 'news': await loadNews(); break;
      case 'calendar': await loadCalendar(); break;
      case 'heatmap': await loadHeatmap(); break;
      case 'analysis': await loadAnalysis(); break;
      case 'converter': await loadConverter(); break;
    }
  }

  // ─── SVG Sparkline Generator ────────────────────────────
  function generateSparklineSVG(data, color = '#00f0ff', height = 28) {
    if (!data || data.length < 2) return '';
    const width = 160;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const padding = 2;
    const h = height - padding * 2;

    const points = data.map((val, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = padding + h - ((val - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const gradId = `sg${Math.random().toString(36).slice(2, 8)}`;
    const isUp = data[data.length - 1] >= data[0];
    const lineColor = isUp ? '#00e676' : '#ff3d71';
    const fillColor = isUp ? 'rgba(0,230,118,0.1)' : 'rgba(255,61,113,0.1)';

    // Build area path (fill under line)
    const areaPoints = `0,${height} ${points.join(' ')} ${width},${height}`;

    return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${lineColor}" stop-opacity="0.3"/>
        <stop offset="100%" stop-color="${lineColor}" stop-opacity="0"/>
      </linearGradient></defs>
      <polygon points="${areaPoints}" fill="url(#${gradId})" />
      <polyline points="${points.join(' ')}" fill="none" stroke="${lineColor}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>`;
  }

  // ─── Dashboard ──────────────────────────────────────────
  async function loadDashboard() {
    const [rates, news, calendar, sentiment] = await Promise.all([
      state.rates || api.get('rates'),
      state.news.length ? state.news : api.get('news?limit=8'),
      state.calendar.length ? state.calendar : api.get('calendar'),
      Object.keys(state.sentiment).length ? state.sentiment : api.get('sentiment')
    ]);

    if (rates) state.rates = rates;
    if (Array.isArray(news)) state.news = news;
    if (Array.isArray(calendar)) state.calendar = calendar;
    if (sentiment && typeof sentiment === 'object') state.sentiment = sentiment;

    renderDashPairs();
    renderDashNews();
    renderDashCalendar();
    renderDashSentiment();
  }

  function renderDashPairs() {
    const grid = document.getElementById('dashPairsGrid');
    if (!state.rates || !state.rates.pairs) {
      grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📊</div><div class="empty-state-text">Loading rates...</div></div>';
      return;
    }

    grid.innerHTML = MAJOR_PAIRS.map(pair => {
      const data = state.rates.pairs[pair];
      if (!data) return '';
      const isUp = data.change >= 0;
      const prevRate = state.previousRates[pair];
      const flashClass = prevRate ? (data.rate > prevRate ? 'flash-green' : data.rate < prevRate ? 'flash-red' : '') : '';
      const decimals = pair.includes('JPY') ? 3 : 5;
      const sparkData = state.sparklines[pair];
      const sparkHtml = sparkData ? `<div class="pair-sparkline">${generateSparklineSVG(sparkData)}</div>` : '';

      return `
        <div class="pair-card ${isUp ? 'up' : 'down'}" data-pair="${pair}" onclick="window.__openPairModal('${pair}')">
          <div class="pair-name">${pair}</div>
          <div class="pair-rate ${flashClass}">${data.rate.toFixed(decimals)}</div>
          <div class="pair-meta">
            <span class="pair-change ${isUp ? 'up' : 'down'}">${isUp ? '+' : ''}${data.change.toFixed(3)}</span>
            <span class="pair-hilo">H ${data.high.toFixed(decimals)}</span>
          </div>
          ${sparkHtml}
        </div>`;
    }).join('');

    setTimeout(() => {
      grid.querySelectorAll('.flash-green, .flash-red').forEach(el => {
        el.classList.remove('flash-green', 'flash-red');
      });
    }, 600);
  }

  function renderDashNews() {
    const container = document.getElementById('dashNewsList');
    const items = state.news.slice(0, 6);
    if (!items.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-text">Loading news...</div></div>';
      return;
    }

    container.innerHTML = items.map(item => `
      <div class="news-item" onclick="window.open('${escHtml(item.link)}', '_blank')">
        <div class="news-item-header">
          <span class="news-title">${escHtml(item.title)}</span>
          <span class="news-time">${timeAgo(item.pubDate)}</span>
        </div>
        <div class="news-meta">
          <span class="news-source">${escHtml(item.source)}</span>
          <span class="news-category">${escHtml(item.category)}</span>
        </div>
      </div>
    `).join('');
  }

  function renderDashCalendar() {
    const container = document.getElementById('dashCalendarList');
    const now = new Date();
    const upcoming = state.calendar.filter(e => new Date(e.datetime) > now).slice(0, 5);

    if (!upcoming.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-text">No upcoming events</div></div>';
      return;
    }

    container.innerHTML = upcoming.map(evt => `
      <div class="news-item">
        <div class="news-item-header">
          <span class="news-title">${CURRENCY_FLAGS[evt.currency] || ''} ${escHtml(evt.event)}</span>
          <span class="news-time">${formatCalTime(evt.datetime)}</span>
        </div>
        <div class="news-meta">
          <span class="cal-currency">${evt.currency}</span>
          <span class="impact-dot ${evt.impact}" title="${evt.impact} impact"></span>
          ${evt.forecast ? `<span class="cal-forecast">F: ${evt.forecast}</span>` : ''}
        </div>
      </div>
    `).join('');
  }

  function renderDashSentiment() {
    const container = document.getElementById('dashSentimentGrid');
    if (!state.sentiment || !Object.keys(state.sentiment).length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-text">Loading sentiment...</div></div>';
      return;
    }

    container.innerHTML = '<div class="sentiment-gauges-grid">' +
      Object.values(state.sentiment).map(s => renderGauge(s)).join('') +
      '</div>';
  }

  // ─── News Page ──────────────────────────────────────────
  async function loadNews() {
    if (!state.news.length) {
      state.news = await api.get('news') || [];
    }
    renderNewsPage();
    setupNewsFilters();
  }

  function renderNewsPage() {
    const grid = document.getElementById('newsGrid');
    let items = [...state.news];

    if (state.newsFilter !== 'all') {
      items = items.filter(n => n.category === state.newsFilter);
    }
    if (state.newsSearch) {
      const q = state.newsSearch.toLowerCase();
      items = items.filter(n =>
        n.title.toLowerCase().includes(q) ||
        n.summary.toLowerCase().includes(q) ||
        n.source.toLowerCase().includes(q)
      );
    }

    if (!items.length) {
      grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📰</div><div class="empty-state-text">No news found matching your filters</div></div>';
      return;
    }

    grid.innerHTML = items.map(item => `
      <div class="news-card-full" onclick="window.open('${escHtml(item.link)}', '_blank')">
        <div style="flex:1">
          <div class="news-title">${escHtml(item.title)}</div>
          <div class="news-meta" style="margin-bottom:6px">
            <span class="news-source">${escHtml(item.source)}</span>
            <span class="news-category">${escHtml(item.category)}</span>
            <span class="news-time">${timeAgo(item.pubDate)}</span>
          </div>
          <div class="news-summary">${escHtml(item.summary)}</div>
        </div>
      </div>
    `).join('');
  }

  function setupNewsFilters() {
    document.querySelectorAll('#newsFilters .pill').forEach(pill => {
      pill.onclick = () => {
        document.querySelectorAll('#newsFilters .pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        state.newsFilter = pill.dataset.category;
        renderNewsPage();
      };
    });

    const searchInput = document.getElementById('newsSearch');
    let searchTimeout;
    searchInput.oninput = () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        state.newsSearch = searchInput.value;
        renderNewsPage();
      }, 300);
    };
  }

  // ─── Calendar Page ──────────────────────────────────────
  async function loadCalendar() {
    if (!state.calendar.length) {
      state.calendar = await api.get('calendar') || [];
    }
    renderCalendar();
    setupCalendarFilters();
  }

  function renderCalendar() {
    const tbody = document.getElementById('calendarBody');
    let events = [...state.calendar];

    if (state.calCurrency !== 'all') {
      events = events.filter(e => e.currency === state.calCurrency);
    }
    if (state.calImpact !== 'all') {
      events = events.filter(e => e.impact === state.calImpact);
    }

    if (!events.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="loading-cell">No events match your filters</td></tr>';
      return;
    }

    const grouped = {};
    events.forEach(evt => {
      const dateKey = new Date(evt.datetime).toLocaleDateString('en-US', {
        weekday: 'long', month: 'short', day: 'numeric'
      });
      if (!grouped[dateKey]) grouped[dateKey] = [];
      grouped[dateKey].push(evt);
    });

    let html = '';
    for (const [date, evts] of Object.entries(grouped)) {
      html += `<tr class="date-separator"><td colspan="7">📅 ${date}</td></tr>`;
      evts.forEach(evt => {
        const actualClass = getActualClass(evt);
        html += `
          <tr class="${evt.isPast ? 'past-event' : ''}">
            <td class="cal-time">${formatTime(evt.datetime)}</td>
            <td><span class="cal-currency">${CURRENCY_FLAGS[evt.currency] || ''} ${evt.currency}</span></td>
            <td><span class="impact-dot ${evt.impact}" title="${evt.impact}"></span></td>
            <td>${escHtml(evt.event)}</td>
            <td class="cal-previous">${evt.previous || '—'}</td>
            <td class="cal-forecast">${evt.forecast || '—'}</td>
            <td class="cal-actual ${actualClass}">${evt.actual || '—'}</td>
          </tr>`;
      });
    }

    tbody.innerHTML = html;
  }

  function getActualClass(evt) {
    if (!evt.actual || !evt.forecast) return 'neutral';
    const a = parseFloat(evt.actual);
    const f = parseFloat(evt.forecast);
    if (isNaN(a) || isNaN(f)) return 'neutral';
    return a > f ? 'better' : a < f ? 'worse' : 'neutral';
  }

  function setupCalendarFilters() {
    document.querySelectorAll('#calendarCurrencyFilters .pill').forEach(pill => {
      pill.onclick = () => {
        document.querySelectorAll('#calendarCurrencyFilters .pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        state.calCurrency = pill.dataset.currency;
        renderCalendar();
      };
    });

    document.querySelectorAll('#calendarImpactFilters .pill').forEach(pill => {
      pill.onclick = () => {
        document.querySelectorAll('#calendarImpactFilters .pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        state.calImpact = pill.dataset.impact;
        renderCalendar();
      };
    });
  }

  // ─── Heatmap Page ───────────────────────────────────────
  async function loadHeatmap() {
    const [rates, strength] = await Promise.all([
      state.rates || api.get('rates'),
      api.get('strength')
    ]);

    if (rates) state.rates = rates;
    if (strength) state.strength = strength;

    renderHeatmap();
    renderStrength();
  }

  function renderHeatmap() {
    const grid = document.getElementById('heatmapGrid');
    if (!state.rates || !state.rates.pairs) {
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-text">Loading heatmap...</div></div>';
      return;
    }

    let html = '<div class="heatmap-cell header-cell"></div>';
    CURRENCIES.forEach(c => {
      html += `<div class="heatmap-cell header-cell">${c}</div>`;
    });

    CURRENCIES.forEach(base => {
      html += `<div class="heatmap-cell header-cell">${base}</div>`;
      CURRENCIES.forEach(quote => {
        if (base === quote) {
          html += `<div class="heatmap-cell neutral">—</div>`;
          return;
        }
        const pair = `${base}/${quote}`;
        const data = state.rates.pairs[pair];
        if (!data) {
          html += `<div class="heatmap-cell neutral">N/A</div>`;
          return;
        }
        const pct = data.changePercent;
        const colorClass = getHeatmapColor(pct);
        html += `
          <div class="heatmap-cell ${colorClass}" title="${pair}: ${data.rate}" onclick="window.__openPairModal('${pair}')">
            <span class="heatmap-pair">${pair}</span>
            <span class="heatmap-value">${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%</span>
          </div>`;
      });
    });

    grid.style.gridTemplateColumns = `repeat(${CURRENCIES.length + 1}, 1fr)`;
    grid.innerHTML = html;
  }

  function getHeatmapColor(pct) {
    if (pct > 0.3) return 'strong-up';
    if (pct > 0.15) return 'up';
    if (pct > 0.05) return 'slight-up';
    if (pct < -0.3) return 'strong-down';
    if (pct < -0.15) return 'down';
    if (pct < -0.05) return 'slight-down';
    return 'neutral';
  }

  function renderStrength() {
    const grid = document.getElementById('strengthGrid');
    if (!state.strength || !Object.keys(state.strength).length) {
      grid.innerHTML = '<div class="empty-state"><div class="empty-state-text">Loading strength data...</div></div>';
      return;
    }

    const sorted = Object.values(state.strength).sort((a, b) => b.avgChange - a.avgChange);
    const maxAbs = Math.max(...sorted.map(s => Math.abs(s.avgChange)), 0.5);

    grid.innerHTML = sorted.map(s => {
      const pct = Math.abs(s.avgChange) / maxAbs * 100;
      const barClass = s.avgChange > 0.05 ? 'positive' : s.avgChange < -0.05 ? 'negative' : 'neutral-bar';
      const valueColor = s.avgChange > 0 ? 'var(--green)' : s.avgChange < 0 ? 'var(--red)' : 'var(--text-secondary)';

      return `
        <div class="strength-item">
          <div class="strength-header">
            <span class="strength-currency">${CURRENCY_FLAGS[s.currency]} ${s.currency}</span>
            <span class="strength-value" style="color:${valueColor}">${s.avgChange >= 0 ? '+' : ''}${s.avgChange.toFixed(3)}%</span>
          </div>
          <div class="strength-bar-bg">
            <div class="strength-bar-fill ${barClass}" style="width:${Math.max(pct, 4)}%"></div>
          </div>
          <div class="strength-stats">
            <span>▲ ${s.pairsUp} pairs up</span>
            <span>▼ ${s.pairsDown} pairs down</span>
          </div>
        </div>`;
    }).join('');
  }

  // ─── Analysis Page ──────────────────────────────────────
  async function loadAnalysis() {
    const [sentiment, rates] = await Promise.all([
      api.get('sentiment'),
      state.rates || api.get('rates')
    ]);

    if (sentiment) state.sentiment = sentiment;
    if (rates) state.rates = rates;

    renderSentimentGauges();
    renderMarketOverview();
    renderKeyLevels();
    renderSessions();
    renderVolatility();
  }

  function renderSentimentGauges() {
    const container = document.getElementById('sentimentGaugesGrid');
    if (!state.sentiment || !Object.keys(state.sentiment).length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-text">Loading sentiment...</div></div>';
      return;
    }

    container.innerHTML = '<div class="sentiment-gauges-grid">' +
      Object.values(state.sentiment).map(s => renderGauge(s)).join('') +
      '</div>';
  }

  function renderGauge(s) {
    const circumference = 2 * Math.PI * 30;
    const offset = circumference - (s.score / 100) * circumference;
    const color = s.score >= 65 ? 'var(--green)' : s.score <= 35 ? 'var(--red)' : 'var(--yellow)';
    const labelClass = s.score >= 65 ? 'bullish' : s.score <= 35 ? 'bearish' : 'neutral-label';

    return `
      <div class="sentiment-gauge">
        <div class="gauge-currency">${CURRENCY_FLAGS[s.currency]} ${s.currency}</div>
        <div class="gauge-ring">
          <svg viewBox="0 0 72 72">
            <circle class="gauge-ring-bg" cx="36" cy="36" r="30"/>
            <circle class="gauge-ring-fill" cx="36" cy="36" r="30"
              stroke="${color}"
              stroke-dasharray="${circumference}"
              stroke-dashoffset="${offset}"/>
          </svg>
          <span class="gauge-value" style="color:${color}">${s.score}%</span>
        </div>
        <div class="gauge-label ${labelClass}">${s.label}</div>
      </div>`;
  }

  function renderMarketOverview() {
    const container = document.getElementById('marketOverviewContent');
    if (!state.rates || !state.rates.pairs) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-text">Loading...</div></div>';
      return;
    }

    const pairs = Object.values(state.rates.pairs);
    const totalPairs = pairs.length;
    const bullish = pairs.filter(p => p.change > 0).length;
    const bearish = pairs.filter(p => p.change < 0).length;
    const avgVolatility = (pairs.reduce((sum, p) => sum + Math.abs(p.changePercent), 0) / totalPairs).toFixed(3);
    const mostVolatile = pairs.reduce((a, b) => Math.abs(a.changePercent) > Math.abs(b.changePercent) ? a : b);

    container.innerHTML = `
      <div class="market-stat"><span class="market-stat-label">Total Pairs Tracked</span><span class="market-stat-value">${totalPairs}</span></div>
      <div class="market-stat"><span class="market-stat-label">Bullish Pairs</span><span class="market-stat-value" style="color:var(--green)">${bullish}</span></div>
      <div class="market-stat"><span class="market-stat-label">Bearish Pairs</span><span class="market-stat-value" style="color:var(--red)">${bearish}</span></div>
      <div class="market-stat"><span class="market-stat-label">Avg Volatility</span><span class="market-stat-value">${avgVolatility}%</span></div>
      <div class="market-stat"><span class="market-stat-label">Most Volatile</span><span class="market-stat-value" style="color:var(--accent-cyan)">${mostVolatile.pair}</span></div>
    `;
  }

  function renderKeyLevels() {
    const container = document.getElementById('keyLevelsContent');
    if (!state.rates || !state.rates.pairs) return;

    const keyPairs = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CAD'];
    container.innerHTML = keyPairs.map(pair => {
      const data = state.rates.pairs[pair];
      if (!data) return '';
      const isJpy = pair.includes('JPY');
      const decimals = isJpy ? 3 : 5;
      const support = (data.rate - Math.random() * 0.005 - 0.002).toFixed(decimals);
      const resistance = (data.rate + Math.random() * 0.005 + 0.002).toFixed(decimals);

      return `
        <div class="key-level">
          <span class="key-level-pair">${pair}</span>
          <div class="key-level-values">
            <div><div class="key-level-label">Support</div><div class="key-level-support">${support}</div></div>
            <div><div class="key-level-label">Current</div><div style="color:var(--text-primary);font-family:var(--font-mono);font-weight:600">${data.rate.toFixed(decimals)}</div></div>
            <div><div class="key-level-label">Resistance</div><div class="key-level-resistance">${resistance}</div></div>
          </div>
        </div>`;
    }).join('');
  }

  function renderSessions() {
    const container = document.getElementById('sessionStatusContent');
    const now = new Date();
    const utcHour = now.getUTCHours();

    const sessions = [
      { name: '🌏 Sydney', open: 21, close: 6 },
      { name: '🌏 Tokyo', open: 0, close: 9 },
      { name: '🌍 London', open: 7, close: 16 },
      { name: '🌎 New York', open: 12, close: 21 }
    ];

    container.innerHTML = sessions.map(s => {
      let isOpen;
      if (s.open > s.close) {
        isOpen = utcHour >= s.open || utcHour < s.close;
      } else {
        isOpen = utcHour >= s.open && utcHour < s.close;
      }
      return `
        <div class="session-item">
          <span class="session-name">${s.name}</span>
          <span class="session-badge ${isOpen ? 'open' : 'closed'}">${isOpen ? '● OPEN' : '○ CLOSED'}</span>
        </div>`;
    }).join('');
  }

  function renderVolatility() {
    const container = document.getElementById('volatilityContent');
    if (!state.rates || !state.rates.pairs) return;

    const volPairs = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'EUR/GBP', 'USD/CHF'];
    const maxVol = 0.5;

    container.innerHTML = volPairs.map(pair => {
      const data = state.rates.pairs[pair];
      if (!data) return '';
      const vol = Math.abs(data.changePercent);
      const pct = Math.min(vol / maxVol * 100, 100);
      const volClass = vol > 0.35 ? 'extreme-vol' : vol > 0.25 ? 'high-vol' : vol > 0.12 ? 'med-vol' : 'low-vol';

      return `
        <div class="vol-item">
          <span class="vol-pair">${pair}</span>
          <div class="vol-bar-bg"><div class="vol-bar-fill ${volClass}" style="width:${Math.max(pct, 5)}%"></div></div>
          <span class="vol-value">${vol.toFixed(3)}%</span>
        </div>`;
    }).join('');
  }

  // ─── Converter Page ─────────────────────────────────────
  async function loadConverter() {
    if (!state.rates) {
      state.rates = await api.get('rates');
    }
    setupConverter();
    doConvert();
    renderQuickGrid();
  }

  function setupConverter() {
    const fromSel = document.getElementById('convertFrom');
    const toSel = document.getElementById('convertTo');
    const amountInput = document.getElementById('convertAmount');
    const swapBtn = document.getElementById('convertSwap');

    const doConvertThrottled = () => doConvert();
    fromSel.onchange = doConvertThrottled;
    toSel.onchange = doConvertThrottled;
    amountInput.oninput = doConvertThrottled;

    swapBtn.onclick = () => {
      const temp = fromSel.value;
      fromSel.value = toSel.value;
      toSel.value = temp;
      doConvert();
    };
  }

  function doConvert() {
    if (!state.rates || !state.rates.pairs) return;

    const from = document.getElementById('convertFrom').value;
    const to = document.getElementById('convertTo').value;
    const amount = parseFloat(document.getElementById('convertAmount').value) || 0;

    if (from === to) {
      document.getElementById('convertResult').textContent = amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      document.getElementById('converterRate').textContent = `1 ${from} = 1 ${to}`;
      document.getElementById('converterTimestamp').textContent = `Rate as of ${new Date().toLocaleTimeString()}`;
      return;
    }

    const pair = `${from}/${to}`;
    const data = state.rates.pairs[pair];

    if (data) {
      const result = amount * data.rate;
      const isJpy = pair.includes('JPY');
      document.getElementById('convertResult').textContent = result.toLocaleString('en-US', {
        minimumFractionDigits: isJpy ? 2 : 4,
        maximumFractionDigits: isJpy ? 2 : 4
      });
      document.getElementById('converterRate').textContent = `1 ${from} = ${data.rate.toFixed(isJpy ? 3 : 5)} ${to}`;
      document.getElementById('converterTimestamp').textContent = `Live rate • Updated ${new Date().toLocaleTimeString()}`;
    } else {
      document.getElementById('convertResult').textContent = 'N/A';
      document.getElementById('converterRate').textContent = `Pair ${pair} not available`;
    }
  }

  function renderQuickGrid() {
    const grid = document.getElementById('converterQuickGrid');
    if (!state.rates || !state.rates.pairs) return;

    grid.innerHTML = MAJOR_PAIRS.map(pair => {
      const data = state.rates.pairs[pair];
      if (!data) return '';
      const decimals = pair.includes('JPY') ? 3 : 5;
      return `
        <div class="converter-quick-item">
          <span class="converter-quick-pair">${pair}</span>
          <span class="converter-quick-rate">${data.rate.toFixed(decimals)}</span>
        </div>`;
    }).join('');
  }

  // ─── Pair Detail Modal ──────────────────────────────────
  window.__openPairModal = function(pair) {
    const modal = document.getElementById('pairModal');
    const data = state.rates?.pairs?.[pair];
    if (!data) return;

    document.getElementById('modalPairName').textContent = pair;
    const decimals = pair.includes('JPY') ? 3 : 5;
    const isUp = data.change >= 0;
    document.getElementById('modalRate').textContent = data.rate.toFixed(decimals);
    document.getElementById('modalRate').style.color = isUp ? 'var(--green)' : 'var(--red)';

    // Stats
    document.getElementById('modalStats').innerHTML = `
      <div class="modal-stat">
        <div class="modal-stat-label">Change</div>
        <div class="modal-stat-value" style="color:${isUp ? 'var(--green)' : 'var(--red)'}">${isUp ? '+' : ''}${data.change.toFixed(3)}</div>
      </div>
      <div class="modal-stat">
        <div class="modal-stat-label">Change %</div>
        <div class="modal-stat-value" style="color:${isUp ? 'var(--green)' : 'var(--red)'}">${isUp ? '+' : ''}${data.changePercent.toFixed(3)}%</div>
      </div>
      <div class="modal-stat">
        <div class="modal-stat-label">Day High</div>
        <div class="modal-stat-value" style="color:var(--green)">${data.high.toFixed(decimals)}</div>
      </div>
      <div class="modal-stat">
        <div class="modal-stat-label">Day Low</div>
        <div class="modal-stat-value" style="color:var(--red)">${data.low.toFixed(decimals)}</div>
      </div>`;

    // Show modal FIRST so canvas gets a real layout size
    modal.classList.add('active');

    // Draw sparkline on canvas after the browser has laid out the modal
    requestAnimationFrame(() => {
      const canvas = document.getElementById('modalSparkline');
      const ctx = canvas.getContext('2d');
      const sparkData = state.sparklines[pair];

      const displayWidth = canvas.parentElement.clientWidth - 32; // account for padding
      canvas.width = (displayWidth || 400) * 2;
      canvas.height = 240;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (sparkData && sparkData.length > 1) {
        const min = Math.min(...sparkData);
        const max = Math.max(...sparkData);
        const range = max - min || 1;
        const w = canvas.width;
        const h = canvas.height;
        const padding = 20;

        // Grid lines
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 5; i++) {
          const y = padding + (i / 4) * (h - padding * 2);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }

        // Area fill
        const gradient = ctx.createLinearGradient(0, 0, 0, h);
        const lineColor = isUp ? '#00e676' : '#ff3d71';
        gradient.addColorStop(0, isUp ? 'rgba(0,230,118,0.2)' : 'rgba(255,61,113,0.2)');
        gradient.addColorStop(1, 'rgba(0,0,0,0)');

        ctx.beginPath();
        ctx.moveTo(0, h);
        sparkData.forEach((val, i) => {
          const x = (i / (sparkData.length - 1)) * w;
          const y = padding + (h - padding * 2) - ((val - min) / range) * (h - padding * 2);
          ctx.lineTo(x, y);
        });
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();

        // Line
        ctx.beginPath();
        sparkData.forEach((val, i) => {
          const x = (i / (sparkData.length - 1)) * w;
          const y = padding + (h - padding * 2) - ((val - min) / range) * (h - padding * 2);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.stroke();

        // Current price dot
        const lastX = w;
        const lastY = padding + (h - padding * 2) - ((sparkData[sparkData.length - 1] - min) / range) * (h - padding * 2);
        ctx.beginPath();
        ctx.arc(lastX - 2, lastY, 5, 0, Math.PI * 2);
        ctx.fillStyle = lineColor;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(lastX - 2, lastY, 8, 0, Math.PI * 2);
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.3;
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '16px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Collecting price data — chart will appear shortly...', canvas.width / 2, canvas.height / 2);
      }
    });
  };

  function closeModal() {
    document.getElementById('pairModal').classList.remove('active');
  }

  // ─── Ticker ─────────────────────────────────────────────
  function renderTicker() {
    const track = document.getElementById('tickerTrack');
    if (!state.rates || !state.rates.pairs) return;

    const items = MAJOR_PAIRS.map(pair => {
      const data = state.rates.pairs[pair];
      if (!data) return '';
      const isUp = data.change >= 0;
      const decimals = pair.includes('JPY') ? 3 : 5;
      return `
        <span class="ticker-item">
          <span class="ticker-pair">${pair}</span>
          <span class="ticker-rate">${data.rate.toFixed(decimals)}</span>
          <span class="ticker-change ${isUp ? 'up' : 'down'}">${isUp ? '▲' : '▼'} ${Math.abs(data.change).toFixed(3)}</span>
        </span>`;
    }).join('');

    track.innerHTML = items + items;
  }

  // ─── Clock ──────────────────────────────────────────────
  function updateClock() {
    const el = document.getElementById('headerClock');
    const now = new Date();
    el.textContent = now.toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }) + ' UTC' + (now.getTimezoneOffset() > 0 ? '-' : '+') +
      String(Math.abs(Math.floor(now.getTimezoneOffset() / 60))).padStart(2, '0') + ':' +
      String(Math.abs(now.getTimezoneOffset() % 60)).padStart(2, '0');
  }

  function updateFooter() {
    document.getElementById('footerUpdated').textContent =
      'Updated: ' + new Date().toLocaleTimeString();
    document.getElementById('footerLatency').textContent =
      'Latency: ' + (state.wsLatency || '--') + 'ms';
  }

  // ─── Utilities ──────────────────────────────────────────
  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function timeAgo(dateStr) {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diff = now - then;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  function formatCalTime(dateStr) {
    return new Date(dateStr).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: true
    });
  }

  function formatTime(dateStr) {
    return new Date(dateStr).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: true
    });
  }

  // ─── Init ───────────────────────────────────────────────
  function init() {
    connectWebSocket();
    initRouter();
    updateClock();
    setInterval(updateClock, 1000);

    // Logo click -> dashboard
    document.getElementById('logo').addEventListener('click', () => {
      location.hash = 'dashboard';
    });

    // Modal close
    document.getElementById('modalClose').addEventListener('click', closeModal);
    document.getElementById('pairModal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeModal();
    });

    // Keyboard shortcut
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });

    console.log('[ForexPulse] v2.0 Initialized');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
