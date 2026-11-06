// Behaviour checks of the persistent stage. usage: CHROME=<chrome binary> [PLAYWRIGHT_CORE=<path>] node behave.cjs <baseUrl> <token> [reduce]
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const [base, tk, reduced] = process.argv.slice(2);
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`); };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, reducedMotion: reduced === 'reduce' ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(([s, t]) => { if (!localStorage.getItem('opc.session')) localStorage.setItem('opc.session', JSON.stringify({ server: s, token: t })); }, [base, tk]);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(base + '/#dashboard');
  await p.waitForSelector('#main .panel');
  await p.waitForTimeout(1200);
  // tag the persistent nodes
  await p.evaluate(() => { for (const sel of ['.stage', '.scrim', '.hud-top', '.hud-bottom', '.scenes .scene']) document.querySelector(sel).dataset.tag = sel; });
  const same = () => p.evaluate(() => ['.stage', '.scrim', '.hud-top', '.hud-bottom', '.scenes .scene'].map((s) => document.querySelector(s)?.dataset.tag === s));
  const underline = () => p.evaluate(() => { const u = document.querySelector('.tab-underline'); const a = document.querySelector('.hud-tabs a[aria-current=page]'); const r = u.getBoundingClientRect(), q = a.getBoundingClientRect(); return { dl: Math.abs(r.left - q.left), dw: Math.abs(r.width - q.width), off: u.classList.contains('off') }; });

  let u = await underline();
  check('underline sits under the active tab at boot', u.dl < 1.5 && u.dw < 1.5, JSON.stringify(u));

  await p.keyboard.press('e'); await p.waitForTimeout(900);
  check('E goes to #jobs', (await p.evaluate(() => location.hash)) === '#jobs');
  check('stage, scrim, HUD bars and the backdrop layer survive a tab switch (same DOM nodes)', (await same()).slice(0, 4).every(Boolean), JSON.stringify(await same()));
  check('focus is on #main after navigation', await p.evaluate(() => document.activeElement?.id === 'main'));
  u = await underline();
  check('underline slid to the new active tab', u.dl < 1.5 && u.dw < 1.5, JSON.stringify(u));
  check('aria-current moved with the tab', await p.evaluate(() => document.querySelector('.hud-tabs a[aria-current=page]')?.getAttribute('href') === '#jobs'));
  check('document title updated', (await p.title()).length > 3, await p.title());
  check('scene changed and old layer dropped (one layer left)', await p.evaluate(() => document.querySelectorAll('.scenes .scene').length === 1), String(await p.evaluate(() => document.querySelectorAll('.scenes .scene').length)));

  // enter animation
  await p.keyboard.press('e');
  await p.waitForTimeout(40);
  const entering = await p.evaluate(() => ({ attr: document.querySelector('#main')?.dataset.enter ?? null, anim: getComputedStyle(document.querySelector('#main .panel') || document.body).animationName }));
  check(reduced === 'reduce' ? 'reduced motion: no enter animation attribute or animation' : 'tab change plays the enter animation, sliding in from the right for E', reduced === 'reduce' ? entering.attr === null && entering.anim === 'none' : entering.attr === 'right' && entering.anim === 'enter', JSON.stringify(entering));
  await p.waitForTimeout(900);
  check('enter attribute removed afterwards', await p.evaluate(() => document.querySelector('#main')?.dataset.enter === undefined));
  await p.keyboard.press('q');
  await p.waitForTimeout(40);
  const back = await p.evaluate(() => document.querySelector('#main')?.dataset.enter ?? null);
  check(reduced === 'reduce' ? 'reduced motion: Q has no enter attribute' : 'Q slides in from the left', reduced === 'reduce' ? back === null : back === 'left', String(back));
  await p.waitForTimeout(900);

  // same-screen redraw: no animation, focus kept, same stage
  await p.goto(base + '/#history'); await p.waitForSelector('#main .panel'); await p.waitForTimeout(1200);
  await p.evaluate(() => { for (const sel of ['.stage', '.hud-top']) document.querySelector(sel).dataset.tag = sel; });
  const seg = p.locator('.seg').nth(1);
  if (await seg.count()) {
    await seg.click();
    await p.waitForTimeout(40);
    const redraw = await p.evaluate(() => ({ enter: document.querySelector('#main')?.dataset.enter ?? null, anim: getComputedStyle(document.querySelector('#main .panel') || document.body).animationName }));
    check('redraw (filter/segment) does NOT replay the enter animation', redraw.enter === null && redraw.anim === 'none', JSON.stringify(redraw));
    check('HUD node survives a redraw', await p.evaluate(() => document.querySelector('.hud-top').dataset.tag === '.hud-top'));
  } else console.log('SKIP  no segment on #history');

  // language switch rebuilds HUD text, keeps stage
  await p.goto(base + '/#settings'); await p.waitForSelector('#main'); await p.waitForTimeout(800);
  const lang = p.locator('select').filter({ hasText: /English|Français/ }).first();
  if (await lang.count()) {
    const before = await p.evaluate(() => document.querySelector('.hud-tabs a').textContent);
    const cur = await lang.inputValue();
    await lang.selectOption(cur === 'fr' ? 'en' : 'fr');
    await p.waitForTimeout(500);
    const after = await p.evaluate(() => document.querySelector('.hud-tabs a').textContent);
    check('language change retranslates the HUD', before !== after, `${before} -> ${after}`);
    await lang.selectOption(cur);
    await p.waitForTimeout(300);
  } else console.log('SKIP  no language select found');

  // skeleton only after 150 ms: slow one route
  await p.goto(base + '/#dashboard'); await p.waitForSelector('#main .panel'); await p.waitForTimeout(1000);
  await p.route('**/api/v1/**', async (r) => { await new Promise((x) => setTimeout(x, 700)); await r.continue(); });
  await p.evaluate(() => { location.hash = '#history'; });
  await p.waitForTimeout(60);
  const early = await p.evaluate(() => !!document.querySelector('.view.loading'));
  await p.waitForTimeout(260);
  const mid = await p.evaluate(() => ({ skeleton: !!document.querySelector('.view.loading'), busy: document.querySelector('#main')?.getAttribute('aria-busy'), hud: !!document.querySelector('.hud-top') }));
  check('no skeleton before 150 ms', !early);
  check('skeleton shown for a slow route (after 150 ms), HUD stays', mid.skeleton && mid.hud, JSON.stringify(mid));
  await p.waitForFunction(() => !document.querySelector('.view.loading') && document.querySelector('#main .panel'), null, { timeout: 8000 });
  check('skeleton replaced by the real screen', true);
  await p.unroute('**/api/v1/**');

  // fast route: never a skeleton
  let sawSkeleton = false;
  await p.exposeFunction('sawLoading', () => { sawSkeleton = true; });
  await p.evaluate(() => { new MutationObserver(() => { if (document.querySelector('.view.loading')) window.sawLoading(); }).observe(document.querySelector('.stage'), { childList: true, subtree: true }); });
  for (const k of ['e', 'q', 'e', 'q']) { await p.keyboard.press(k); await p.waitForTimeout(250); }
  check('fast loads never show the skeleton', !sawSkeleton);

  check('no page errors / console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await b.close();
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
