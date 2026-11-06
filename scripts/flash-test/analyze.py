"""Flash detector. A frame is a flash when its mean luminance is lower than BOTH neighbours by more than X (a V-shaped dip)
AND it was on screen for less than MAXMS (a blank frame between two good ones). A screen that legitimately differs in brightness
and stays up for ~900 ms (e.g. dashboard -> jobs -> dashboard) is a V too, but not a flash. Cross-fades are monotonic and never count."""
import json, sys, glob
from PIL import Image, ImageStat

d = sys.argv[1]
X = float(sys.argv[2]) if len(sys.argv) > 2 else 6.0
MAXMS = float(sys.argv[3]) if len(sys.argv) > 3 else 250.0
files = sorted(glob.glob(f'{d}/0*.jpg'))
meta = json.load(open(f'{d}/meta.json'))
ts = meta['ts']
lum = [ImageStat.Stat(Image.open(f).convert('L')).mean[0] for f in files]
dur = [(ts[i + 1] - ts[i]) * 1000 if i + 1 < len(ts) else 1e9 for i in range(len(ts))]
dips, long_dips = [], []
for i in range(1, len(lum) - 1):
    drop = min(lum[i - 1], lum[i + 1]) - lum[i]
    if drop > X:
        (dips if dur[i] < MAXMS else long_dips).append((i, round(drop, 1), round(dur[i]), round(lum[i - 1], 1), round(lum[i], 1), round(lum[i + 1], 1)))
shorts = [(min(lum[i - 1], lum[i + 1]) - lum[i]) for i in range(1, len(lum) - 1) if dur[i] < MAXMS]
print(f'{d}: frames={len(lum)} switches={len(meta["keys"])} lum min={min(lum):.1f} max={max(lum):.1f} FLASHES(drop>{X}, shown<{MAXMS:.0f}ms)={len(dips)}  steady-dips(not flashes)={len(long_dips)}')
for x in dips:
    print('  FLASH frame %d: drop %s, on screen %s ms (prev %s, cur %s, next %s)' % x)
for x in long_dips:
    print('  steady frame %d: drop %s but on screen %s ms = a real screen (prev %s, cur %s, next %s)' % x)
print(f'  largest short-lived V-dip: {max(shorts) if shorts else 0:.2f}')
