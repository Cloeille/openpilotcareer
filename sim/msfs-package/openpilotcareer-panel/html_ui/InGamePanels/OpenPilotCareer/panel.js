/* EFB tablet UI: renders view models from view-model.js and polls the bridge status endpoint.
 * Framework-free ES5 so it runs unchanged in the sim and in a normal browser (mock/index.html).
 * Bridge data only ever reaches the DOM through textContent. Keys: Left/Right or Q/E switch tabs, Enter closes a parked flight. */
(function (root) {
  'use strict';

  var VM = root.OPCViewModel;
  var STATUS_URL = 'http://127.0.0.1:7878/status';
  var POLL_INTERVAL_MS = 2000;
  var REQUEST_TIMEOUT_MS = 1500;
  var LANG_KEY = 'opc-panel-lang';
  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* Lucide icons (https://lucide.dev, ISC), same set as the web app. 24x24, stroke currentColor. */
  var ICONS = {
    'plane': [['path', 'M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z']],
    'plane-takeoff': [['path', 'M2 22h20'], ['path', 'M6.36 17.4 4 17l-2-4 1.1-.55a2 2 0 0 1 1.8 0l.17.1a2 2 0 0 0 1.8 0L8 12 5 6l.9-.45a2 2 0 0 1 2.09.2l4.02 3a2 2 0 0 0 2.1.2l4.19-2.06a2.41 2.41 0 0 1 1.73-.17L21 7a1.4 1.4 0 0 1 .87 1.99l-.38.76c-.23.46-.6.84-1.07 1.08L7.58 17.2a2 2 0 0 1-1.22.18Z']],
    'clipboard-list': [['rect', { width: 8, height: 4, x: 8, y: 2, rx: 1, ry: 1 }], ['path', 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2'], ['path', 'M12 11h4'], ['path', 'M12 16h4'], ['path', 'M8 11h.01'], ['path', 'M8 16h.01']],
    'file-text': [['path', 'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z'], ['path', 'M14 2v5a1 1 0 0 0 1 1h5'], ['path', 'M10 9H8'], ['path', 'M16 13H8'], ['path', 'M16 17H8']],
    'armchair': [['path', 'M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3'], ['path', 'M3 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0z'], ['path', 'M5 18v2'], ['path', 'M19 18v2']],
    'wifi': [['path', 'M12 20h.01'], ['path', 'M2 8.82a15 15 0 0 1 20 0'], ['path', 'M5 12.859a10 10 0 0 1 14 0'], ['path', 'M8.5 16.429a5 5 0 0 1 7 0']],
    'wifi-off': [['path', 'M12 20h.01'], ['path', 'M8.5 16.429a5 5 0 0 1 7 0'], ['path', 'M5 12.859a10 10 0 0 1 5.17-2.69'], ['path', 'M19 12.859a10 10 0 0 0-2.007-1.523'], ['path', 'M2 8.82a15 15 0 0 1 4.177-2.643'], ['path', 'M22 8.82a15 15 0 0 0-11.288-3.764'], ['path', 'm2 2 20 20']],
    'battery-medium': [['path', 'M10 14v-4'], ['path', 'M22 14v-4'], ['path', 'M6 14v-4'], ['rect', { x: 2, y: 6, width: 16, height: 12, rx: 2 }]],
    'scan-line': [['path', 'M3 7V5a2 2 0 0 1 2-2h2'], ['path', 'M17 3h2a2 2 0 0 1 2 2v2'], ['path', 'M21 17v2a2 2 0 0 1-2 2h-2'], ['path', 'M7 21H5a2 2 0 0 1-2-2v-2'], ['path', 'M7 12h10']],
    'shield-check': [['path', 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z'], ['path', 'm9 12 2 2 4-4']],
    'shield-x': [['path', 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z'], ['path', 'm14.5 9.5-5 5'], ['path', 'm9.5 9.5 5 5']],
    'circle-parking': [['circle', { cx: 12, cy: 12, r: 10 }], ['path', 'M9 12h4a2 2 0 0 0 0-4H9.5a.5.5 0 0 0-.5.5V16']],
    'chevron-right': [['path', 'm9 18 6-6-6-6']],
    'arrow-up-right': [['path', 'M7 7h10v10'], ['path', 'M7 17 17 7']],
    'triangle-alert': [['path', 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3'], ['path', 'M12 9v4'], ['path', 'M12 17h.01']]
  };
  var TAB_ICON = { flight: 'plane', job: 'clipboard-list', simbrief: 'file-text', cabin: 'armchair' };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function icon(name, size) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'opc-icon');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    (ICONS[name] || []).forEach(function (shape) {
      var node = document.createElementNS(SVG_NS, shape[0]);
      var attrs = shape[1];
      if (typeof attrs === 'string') node.setAttribute('d', attrs);
      else for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) node.setAttribute(k, String(attrs[k]));
      svg.appendChild(node);
    });
    return svg;
  }

  function srOnly(text) {
    return el('span', 'opc-sr', text);
  }

  function storedLang() {
    try {
      var v = root.localStorage && root.localStorage.getItem(LANG_KEY);
      return v === 'fr' || v === 'en' ? v : null;
    } catch (e) {
      return null;
    }
  }
  function storeLang(lang) {
    try {
      if (root.localStorage) root.localStorage.setItem(LANG_KEY, lang);
    } catch (e) {
      /* storage unavailable: the choice lasts until the panel is closed */
    }
  }
  function systemLang() {
    var nav = root.navigator;
    var tag = nav && (nav.language || (nav.languages && nav.languages[0]));
    return VM.pickLang(tag);
  }

  /* ---- pieces of the tablet ---- */
  function renderStatusBar(vm, onLang) {
    var h = vm.header;
    var bar = el('header', 'opc-statusbar');
    var left = el('div', 'opc-sb-left');
    var mark = el('div', 'opc-mark');
    mark.appendChild(icon('plane-takeoff', 11));
    left.appendChild(mark);
    left.appendChild(el('h1', 'opc-appname', h.brand));
    var bridge = el('div', 'opc-bridge');
    bridge.setAttribute('data-tone', h.bridgeTone);
    var dot = el('span', 'opc-dot');
    dot.setAttribute('aria-hidden', 'true');
    bridge.appendChild(dot);
    /* Healthy: dot only, like the design, with the text for screen readers. Anything else: the text is shown too. */
    bridge.appendChild(el('span', h.bridgeTone === 'ok' ? 'opc-sr' : 'opc-bridge-text', h.bridgeTone === 'ok' ? h.bridgeSr : h.bridgeLabel));
    left.appendChild(bridge);
    bar.appendChild(left);

    var right = el('div', 'opc-sb-right');
    right.appendChild(el('span', 'opc-clock opc-mono', h.clock));
    var lang = el('button', 'opc-lang', vm.lang === 'fr' ? 'EN' : 'FR');
    lang.type = 'button';
    lang.setAttribute('data-focus', 'lang');
    lang.setAttribute('lang', vm.lang === 'fr' ? 'en' : 'fr');
    lang.setAttribute('aria-label', vm.lang === 'fr' ? 'Switch to English' : 'Passer en fran\u00E7ais');
    lang.onclick = onLang;
    right.appendChild(lang);
    right.appendChild(icon(vm.connection === 'online' ? 'wifi' : 'wifi-off', 14));
    right.appendChild(icon('battery-medium', 16));
    bar.appendChild(right);
    return bar;
  }

  function renderTabs(vm, current, onSelect) {
    var list = el('div', 'opc-tabs');
    list.setAttribute('role', 'tablist');
    list.setAttribute('aria-label', vm.tabsLabel);
    vm.tabs.forEach(function (t) {
      var selected = t.key === current;
      var b = el('button', 'opc-tab');
      b.type = 'button';
      b.id = 'opc-tab-' + t.key;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', selected ? 'true' : 'false');
      b.setAttribute('aria-controls', 'opc-panel');
      b.setAttribute('tabindex', selected ? '0' : '-1');
      b.setAttribute('data-focus', 'tab-' + t.key);
      b.appendChild(icon(TAB_ICON[t.key], 16));
      b.appendChild(el('span', 'opc-tab-label', t.label));
      b.onclick = function () { onSelect(t.key); };
      list.appendChild(b);
    });
    return list;
  }

  function renderRoute(route) {
    var wrap = el('div', 'opc-route');
    wrap.appendChild(el('span', 'opc-sign opc-sign-from', route.from));
    var track = el('div', 'opc-track');
    track.setAttribute('role', 'img');
    track.setAttribute('aria-label', route.label);
    if (route.progress === null) {
      track.setAttribute('data-known', 'false');
    } else {
      var flown = el('div', 'opc-track-flown');
      flown.style.width = (route.progress * 100).toFixed(1) + '%';
      track.appendChild(flown);
      track.appendChild(el('div', 'opc-track-plane'));
    }
    track.appendChild(el('div', 'opc-track-rest'));
    wrap.appendChild(track);
    var to = el('span', 'opc-sign opc-sign-to', route.to);
    to.appendChild(icon('arrow-up-right', 16));
    wrap.appendChild(to);
    return wrap;
  }

  function renderStages(steps) {
    var list = el('ol', 'opc-stages');
    steps.forEach(function (st) {
      var li = el('li', 'opc-stage');
      li.setAttribute('data-state', st.state);
      if (st.state === 'current') li.setAttribute('aria-current', 'step');
      li.appendChild(el('div', 'opc-stage-bar'));
      li.appendChild(el('div', 'opc-stage-label', st.label));
      li.appendChild(srOnly(' (' + st.srText + ')'));
      list.appendChild(li);
    });
    return list;
  }

  function renderFacts(items, className) {
    var wrap = el('dl', 'opc-facts ' + (className || ''));
    items.forEach(function (it) {
      var box = el('div', 'opc-fact');
      box.appendChild(el('dt', 'opc-fact-label', it.label));
      box.appendChild(el('dd', 'opc-fact-value', it.value));
      if (it.sub) box.appendChild(el('dd', 'opc-fact-sub', it.sub));
      wrap.appendChild(box);
    });
    return wrap;
  }

  function renderStatus(status) {
    var s = el('p', 'opc-status');
    s.setAttribute('data-tone', status.tone);
    if (status.icon === 'parking') s.appendChild(icon('circle-parking', 15));
    else {
      var dot = el('span', 'opc-live-dot');
      dot.setAttribute('aria-hidden', 'true');
      s.appendChild(dot);
    }
    s.appendChild(el('span', 'opc-status-text', status.text));
    return s;
  }

  function renderTitle(view) {
    var box = el('div', 'opc-heading');
    box.appendChild(el('h2', 'opc-title', view.title));
    if (view.meta) box.appendChild(el('p', 'opc-meta', view.meta));
    return box;
  }

  function renderVerdict(v) {
    var box = el('section', 'opc-verdict');
    box.setAttribute('data-tone', v.tone);
    var ic = icon(v.icon, 22);
    ic.setAttribute('class', 'opc-icon opc-verdict-icon');
    box.appendChild(ic);
    var text = el('div', 'opc-verdict-text');
    text.appendChild(el('h3', 'opc-verdict-title', v.title));
    text.appendChild(el('p', 'opc-verdict-sub', v.text));
    box.appendChild(text);
    var gain = el('div', 'opc-gain');
    gain.setAttribute('data-tone', v.gainTone);
    gain.appendChild(el('p', 'opc-gain-label', v.gainLabel));
    gain.appendChild(el('p', 'opc-gain-value', v.gainValue));
    box.appendChild(gain);
    return box;
  }

  function renderFlightBody(view) {
    var frag = document.createDocumentFragment();
    if (view.kind === 'flight') {
      frag.appendChild(renderStatus(view.status));
      frag.appendChild(renderTitle(view));
      frag.appendChild(renderRoute(view.route));
      frag.appendChild(renderStages(view.steps));
      frag.appendChild(renderFacts(view.facts));
    } else if (view.kind === 'result') {
      frag.appendChild(renderStatus(view.status));
      frag.appendChild(renderTitle(view));
      frag.appendChild(renderFacts(view.results, 'opc-results'));
      frag.appendChild(renderVerdict(view.verdict));
    } else {
      frag.appendChild(renderTitle(view));
      frag.appendChild(el('p', 'opc-lead', view.text));
    }
    return frag;
  }

  function renderPage(page) {
    var frag = document.createDocumentFragment();
    page.sections.forEach(function (sec) {
      var s = el('section', 'opc-section');
      s.appendChild(el('h2', 'opc-h2', sec.title));
      var dl = el('dl', 'opc-rows');
      sec.rows.forEach(function (r) {
        var line = el('div', 'opc-row');
        line.appendChild(el('dt', null, r.label));
        line.appendChild(el('dd', r.mono ? 'opc-mono' : null, r.value));
        dl.appendChild(line);
      });
      s.appendChild(dl);
      if (sec.list) {
        var ul = el('ul', 'opc-flaglist');
        sec.list.forEach(function (text) {
          var li = el('li');
          li.appendChild(icon('triangle-alert', 15));
          li.appendChild(el('span', null, text));
          ul.appendChild(li);
        });
        s.appendChild(ul);
      }
      if (sec.note) s.appendChild(el('p', 'opc-note', sec.note));
      frag.appendChild(s);
    });
    return frag;
  }

  function renderFooter(vm, onClose, onLink) {
    var f = vm.footer;
    var bar = el('footer', 'opc-footer');
    if (f.link) {
      var link = el('button', 'opc-ghost');
      link.type = 'button';
      link.setAttribute('data-focus', 'link');
      link.appendChild(el('span', null, f.link.label));
      link.appendChild(icon('chevron-right', 16));
      link.onclick = onLink;
      bar.appendChild(link);
    } else {
      var verif = el('p', 'opc-verif');
      verif.setAttribute('data-tone', f.verifTone);
      verif.appendChild(icon(f.verifIcon, 15));
      verif.appendChild(el('span', null, f.verifText));
      bar.appendChild(verif);
    }
    var close = el('div', 'opc-close');
    if (f.hint) close.appendChild(el('span', 'opc-close-hint', f.hint));
    var btn = el('button', 'opc-btn' + (f.canClose ? ' opc-has-key' : ''));
    btn.type = 'button';
    btn.setAttribute('data-focus', 'close');
    btn.appendChild(el('span', 'opc-btn-label', f.closeLabel));
    if (f.canClose) {
      btn.setAttribute('aria-keyshortcuts', 'Enter');
      var key = el('span', 'opc-key', f.closeKey);
      key.setAttribute('aria-hidden', 'true');
      btn.appendChild(key);
      btn.onclick = onClose;
    } else {
      btn.disabled = true;
    }
    close.appendChild(btn);
    bar.appendChild(close);
    return bar;
  }

  function renderNotice(vm) {
    var box = el('section', 'opc-notice');
    box.setAttribute('data-connection', vm.connection);
    box.setAttribute('role', 'alert');
    box.appendChild(el('h2', 'opc-notice-title', vm.connectionLabel));
    box.appendChild(el('p', 'opc-notice-text', vm.notice));
    return box;
  }

  /* options: { lang: 'en'|'fr' } forces the language (the mock page uses ?lang=); otherwise the stored choice, then the system one. */
  function mount(container, options) {
    var opts = options || {};
    var lang = opts.lang ? VM.pickLang(opts.lang) : storedLang() || systemLang();
    var tab = 'flight';
    var closedKey = null;
    var build = null; // (o) -> view model for the last bridge answer; null before the first one
    var shown = null;
    var running = false;
    var generation = 0;
    var timer = null;
    var vm = null;

    container.className = 'opc';
    container.setAttribute('tabindex', '0');
    container.setAttribute('lang', lang);
    var screen = el('div', 'opc-screen');
    var live = el('div', 'opc-sr');
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    container.appendChild(screen);
    container.appendChild(live);

    function compute() {
      return build ? build({ lang: lang, closed: closedKey }) : VM.connecting(lang);
    }

    function render() {
      var focusId = null;
      var active = document.activeElement;
      if (active && screen.contains(active)) focusId = active.getAttribute('data-focus');
      var body = screen.querySelector('.opc-body');
      var scroll = body ? body.scrollTop : 0;

      var frag = document.createDocumentFragment();
      frag.appendChild(renderStatusBar(vm, toggleLang));
      var main = el('main', 'opc-body');
      if (vm.tabs) {
        if (!vm.pages[tab] && tab !== 'flight') tab = 'flight';
        frag.appendChild(renderTabs(vm, tab, selectTab));
        main.id = 'opc-panel';
        main.setAttribute('role', 'tabpanel');
        main.setAttribute('aria-labelledby', 'opc-tab-' + tab);
        main.appendChild(tab === 'flight' ? renderFlightBody(vm.view) : renderPage(vm.pages[tab]));
        frag.appendChild(main);
        frag.appendChild(renderFooter(vm, closeFlight, function () { selectTab('job'); }));
      } else {
        main.appendChild(renderNotice(vm));
        frag.appendChild(main);
      }
      screen.textContent = '';
      screen.appendChild(frag);
      var newBody = screen.querySelector('.opc-body');
      if (newBody) newBody.scrollTop = scroll;
      if (focusId) {
        var again = screen.querySelector('[data-focus="' + focusId + '"]');
        if (again && !again.disabled) again.focus();
      }
    }

    function refresh(force) {
      vm = compute();
      var signature = JSON.stringify([vm, tab]);
      if (force || signature !== shown) {
        shown = signature;
        render();
      }
      if (live.textContent !== vm.announcement) live.textContent = vm.announcement;
    }

    function safeRefresh(force) {
      try {
        refresh(force);
      } catch (e) {
        if (root.console) root.console.error('OpenPilotCareer panel render failed', e);
      }
    }

    function selectTab(key) {
      if (!vm || !vm.tabs || key === tab) return;
      tab = key;
      safeRefresh(true);
      var b = screen.querySelector('[data-focus="tab-' + key + '"]');
      if (b) b.focus();
    }

    function stepTab(delta) {
      if (!vm || !vm.tabs) return;
      var keys = vm.tabs.map(function (t) { return t.key; });
      var at = keys.indexOf(tab);
      selectTab(keys[(at + delta + keys.length) % keys.length]);
    }

    function closeFlight() {
      if (!vm || !vm.canClose) return;
      closedKey = vm.closeKey;
      tab = 'flight';
      safeRefresh(true);
    }

    function toggleLang() {
      lang = lang === 'fr' ? 'en' : 'fr';
      storeLang(lang);
      container.setAttribute('lang', lang);
      safeRefresh(true);
    }

    container.onkeydown = function (ev) {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      var k = ev.key;
      var onControl = ev.target && ev.target !== container && /^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(ev.target.tagName);
      if (k === 'ArrowRight' || k === 'e' || k === 'E') {
        stepTab(1);
        ev.preventDefault();
      } else if (k === 'ArrowLeft' || k === 'q' || k === 'Q') {
        stepTab(-1);
        ev.preventDefault();
      } else if (k === 'Enter' && !onControl && vm && vm.canClose) {
        closeFlight();
        ev.preventDefault();
      }
    };

    function poll() {
      var gen = generation;
      var xhr = null;
      var settled = false;
      var guard = null;

      function settle(builder) {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        if (gen !== generation) return;
        build = builder;
        safeRefresh(false);
        timer = setTimeout(poll, POLL_INTERVAL_MS);
      }

      try {
        xhr = new XMLHttpRequest();
        xhr.open('GET', STATUS_URL, true);
        xhr.onload = function () {
          var status = xhr.status;
          var text = xhr.responseText;
          settle(function (o) {
            try {
              return VM.fromResponse(status, text, o);
            } catch (e) {
              return VM.error(VM.problem('read', o.lang), o.lang);
            }
          });
        };
        xhr.onerror = function () {
          settle(function (o) { return VM.offline(o.lang); });
        };
        xhr.onabort = xhr.onerror;
        guard = setTimeout(function () {
          try {
            xhr.abort();
          } catch (e) {
            /* already finished */
          }
          settle(function (o) { return VM.offline(o.lang); });
        }, REQUEST_TIMEOUT_MS);
        xhr.send();
      } catch (e) {
        settle(function (o) { return VM.error(VM.problem('send', o.lang), o.lang); });
      }
    }

    function start() {
      if (running) return;
      running = true;
      poll();
    }

    function stop() {
      running = false;
      generation++;
      clearTimeout(timer);
    }

    safeRefresh(true);
    return { start: start, stop: stop };
  }

  root.OPCPanel = { mount: mount };
})(this);
