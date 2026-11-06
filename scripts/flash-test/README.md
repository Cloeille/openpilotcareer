# Screen-switch flash test

Needs a built web (`npm run build`), a running server with a registered user (`OPC_WEB_ROOT=packages/web/dist`), `playwright-core`, a Chromium binary and Python with Pillow.

```
CHROME=/path/to/chrome node scripts/flash-test/capture.cjs http://127.0.0.1:36777 out no 1 <token>   # 10 Q/E switches, screencast frames
python3 scripts/flash-test/analyze.py out 6 250   # prints FLASHES(...)=N; 0 is a pass

CHROME=/path/to/chrome node scripts/flash-test/behave.cjs http://127.0.0.1:36777 <token> [reduce]    # persistent stage, enter animation, redraw, skeleton delay
```

A flash is a frame whose mean luminance is lower than both neighbours by more than 6 (of 255) and which stays on screen less than 250 ms: a blank backdrop between two good frames. A screen that is simply darker and stays up is not one. Before the fix: 2 flashes in 10 switches (dips of 9.4 and 8.9); after: 0 (largest dip 0.55).
