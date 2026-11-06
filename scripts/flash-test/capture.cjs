// Records compositor frames (CDP screencast) while pressing Q/E, saves them as jpgs for analyze.py.
// usage: CHROME=<chrome binary> [PLAYWRIGHT_CORE=<path>] node capture.cjs <baseUrl> <outDir> [reduce|no] [cpuThrottle] <token>
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const fs = require('fs');
const [base, out, reduced = 'no', throttle = '1', token] = process.argv.slice(2);
(async () => {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, reducedMotion: reduced === 'reduce' ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(([b, tk]) => localStorage.setItem('opc.session', JSON.stringify({ server: b, token: tk })), [base, token]);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await page.goto(base + '/#dashboard');
  await page.waitForSelector('#main', { timeout: 15000 });
  await page.waitForTimeout(2500);
  if (Number(throttle) > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(throttle) });
  const frames = [];
  cdp.on('Page.screencastFrame', async (f) => {
    frames.push({ ts: f.metadata.timestamp, data: f.data });
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: 480, maxHeight: 270, everyNthFrame: 1 });
  const marks = [];
  const t0 = Date.now();
  const keys = ['e', 'e', 'e', 'e', 'q', 'q', 'q', 'q', 'e', 'q'];
  for (const k of keys) {
    marks.push((Date.now() - t0) / 1000);
    await page.keyboard.press(k);
    await page.waitForTimeout(900);
  }
  await cdp.send('Page.stopScreencast');
  frames.forEach((f, i) => fs.writeFileSync(`${out}/${String(i).padStart(4, '0')}.jpg`, Buffer.from(f.data, 'base64')));
  fs.writeFileSync(`${out}/meta.json`, JSON.stringify({ ts: frames.map((f) => f.ts), marks, keys }));
  console.log('frames', frames.length, 'hash', await page.evaluate(() => location.hash));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
