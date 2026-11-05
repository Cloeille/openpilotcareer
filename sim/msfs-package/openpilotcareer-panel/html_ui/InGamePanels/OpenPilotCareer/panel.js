/* Panel UI: renders view models from view-model.js and polls the bridge status endpoint.
 * Framework-free ES5 so it runs unchanged in the sim and in a normal browser (mock/index.html).
 * Bridge data only ever reaches the DOM through textContent. */
(function (root) {
  'use strict';

  var VM = root.OPCViewModel;
  var STATUS_URL = 'http://127.0.0.1:7878/status';
  var POLL_INTERVAL_MS = 2000;
  var REQUEST_TIMEOUT_MS = 1500;

  var CONNECTION_GLYPH = { online: '\u25CF', connecting: '\u25CC', offline: '\u2716', error: '\u26A0' };
  var VERIFICATION_GLYPH = { pending: '\u25D4', verified: '\u2714', rejected: '\u2716', none: '\u2013' };
  var STEP_GLYPH = { done: '\u2714', current: '\u25B6', todo: '\u25CB' };
  var STEP_SR_TEXT = { done: 'completed', current: 'current', todo: 'not reached' };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function glyph(char) {
    var g = el('span', 'opc-glyph', char);
    g.setAttribute('aria-hidden', 'true');
    return g;
  }

  function srOnly(text) {
    return el('span', 'opc-sr', text);
  }

  var headingSeq = 0;
  function section(title, className) {
    var s = el('section', 'opc-section ' + (className || ''));
    var h = el('h2', 'opc-h2', title);
    h.id = 'opc-h-' + ++headingSeq;
    s.setAttribute('aria-labelledby', h.id);
    s.appendChild(h);
    return s;
  }

  function renderJob(job) {
    var s = section('Current job');
    s.appendChild(el('p', 'opc-route' + (job.active ? '' : ' opc-muted'), job.route));
    if (job.active) {
      var p = el('p', 'opc-line');
      p.appendChild(el('span', 'opc-label', 'Aircraft '));
      p.appendChild(el('strong', 'opc-value', job.aircraft));
      s.appendChild(p);
    }
    return s;
  }

  function renderPhase(phase) {
    var s = section('Flight phase');
    s.appendChild(el('p', 'opc-phase', phase.summary));
    var list = el('ol', 'opc-steps');
    phase.steps.forEach(function (step) {
      var li = el('li', 'opc-step');
      li.setAttribute('data-state', step.state);
      if (step.state === 'current') li.setAttribute('aria-current', 'step');
      li.appendChild(glyph(STEP_GLYPH[step.state]));
      li.appendChild(el('span', 'opc-step-label', step.label));
      li.appendChild(srOnly(' (' + STEP_SR_TEXT[step.state] + ')'));
      list.appendChild(li);
    });
    s.appendChild(list);
    return s;
  }

  function renderVerification(v) {
    var s = section('Verification');
    var badge = el('p', 'opc-badge');
    badge.setAttribute('data-verification', v.key);
    badge.appendChild(glyph(VERIFICATION_GLYPH[v.key]));
    badge.appendChild(el('span', 'opc-badge-label', v.label));
    s.appendChild(badge);
    if (v.reason) {
      var p = el('p', 'opc-line');
      p.appendChild(el('span', 'opc-label', 'Reason: '));
      p.appendChild(el('span', 'opc-reason', v.reason));
      s.appendChild(p);
    }
    return s;
  }

  function renderFlags(flags) {
    var s = section('Anti-cheat flags', flags.count ? 'opc-has-flags' : '');
    s.appendChild(el('p', 'opc-line' + (flags.count ? ' opc-flag-count' : ' opc-muted'), flags.summary));
    if (flags.count) {
      var ul = el('ul', 'opc-flags');
      flags.items.forEach(function (text) {
        var li = el('li', 'opc-flag');
        li.appendChild(glyph('\u26A0'));
        li.appendChild(el('span', 'opc-flag-text', text));
        ul.appendChild(li);
      });
      s.appendChild(ul);
      if (flags.hiddenCount) s.appendChild(el('p', 'opc-line opc-muted', '+ ' + flags.hiddenCount + ' more not shown'));
    }
    return s;
  }

  function renderConnection(vm) {
    var p = el('p', 'opc-conn');
    p.setAttribute('data-connection', vm.connection);
    p.appendChild(glyph(CONNECTION_GLYPH[vm.connection]));
    p.appendChild(el('span', 'opc-conn-label', vm.connectionLabel));
    return p;
  }

  function mount(container) {
    container.className = 'opc';
    var content = el('div', 'opc-content');
    var checked = el('p', 'opc-checked opc-muted');
    var live = el('div', 'opc-sr');
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    container.appendChild(content);
    container.appendChild(checked);
    container.appendChild(live);

    var shown = null;
    var running = false;
    var generation = 0;
    var timer = null;

    function render(vm) {
      var frame = document.createDocumentFragment();
      var head = el('header', 'opc-head');
      head.appendChild(el('h1', 'opc-h1', 'OpenPilotCareer'));
      head.appendChild(renderConnection(vm));
      frame.appendChild(head);
      container.setAttribute('data-connection', vm.connection);
      if (vm.notice) {
        var notice = el('p', 'opc-notice', vm.notice);
        frame.appendChild(notice);
      }
      if (vm.job) {
        frame.appendChild(renderJob(vm.job));
        frame.appendChild(renderPhase(vm.phase));
        frame.appendChild(renderVerification(vm.verification));
        frame.appendChild(renderFlags(vm.flags));
        var foot = el('p', 'opc-server opc-muted');
        foot.appendChild(el('span', 'opc-label', 'Career server '));
        foot.appendChild(el('span', 'opc-value', vm.serverUrl));
        frame.appendChild(foot);
      }
      var scroll = container.scrollTop;
      content.textContent = '';
      content.appendChild(frame);
      container.scrollTop = scroll;
    }

    function show(vm) {
      var signature = JSON.stringify(vm);
      if (signature !== shown) {
        shown = signature;
        render(vm);
        live.textContent = vm.announcement;
      }
      checked.textContent = 'Last checked ' + new Date().toLocaleTimeString();
    }

    function safeShow(vm) {
      try {
        show(vm);
      } catch (e) {
        if (root.console) root.console.error('OpenPilotCareer panel render failed', e);
      }
    }

    function poll() {
      var gen = generation;
      var xhr = null;
      var settled = false;
      var guard = null;

      function settle(vm) {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        if (gen !== generation) return;
        safeShow(vm);
        timer = setTimeout(poll, POLL_INTERVAL_MS);
      }

      try {
        xhr = new XMLHttpRequest();
        xhr.open('GET', STATUS_URL, true);
        xhr.onload = function () {
          var vm;
          try {
            vm = VM.fromResponse(xhr.status, xhr.responseText);
          } catch (e) {
            vm = VM.error('The panel could not read the answer.');
          }
          settle(vm);
        };
        xhr.onerror = function () {
          settle(VM.offline());
        };
        xhr.onabort = xhr.onerror;
        guard = setTimeout(function () {
          try {
            xhr.abort();
          } catch (e) {
            /* already finished */
          }
          settle(VM.offline());
        }, REQUEST_TIMEOUT_MS);
        xhr.send();
      } catch (e) {
        settle(VM.error('The panel could not send the request.'));
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

    safeShow(VM.connecting());
    return { start: start, stop: stop };
  }

  root.OPCPanel = { mount: mount };
})(this);
