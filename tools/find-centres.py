#!/usr/bin/env python3
"""Find the centre of the circles in each gallery picture, ahead of time, and record it in images/bhavacakra/manifest.json.

The rings of the visualizer are drawn over the middle of the slideshow; most of the pictures are mandalas or wheels whose circles are not
centred in the frame, so each picture's circle centre is measured here and the page places the rings on it.

Method (fast radial symmetry): every strong edge votes for the points that a circle passing through it could be centred on, at several
radii; concentric rings all vote for the same point, so the votes pile up on the hub. The strongest point is the centre. A centre is
kept only when its peak clearly beats the runner-up (the picture really has one dominant circle) and lies well inside the picture;
otherwise the entry gets no "center" and the page uses the middle of the picture.

Needs macOS `sips` (to read the 256px thumbnails) and nothing else. Run from the repository root:  python3 tools/find-centres.py
Add --dry-run to print the table without writing the manifest.
"""
import json, math, os, re, struct, subprocess, sys, tempfile

SIZE = 160            # analysis size (longest side, pixels)
MIN_DOMINANCE = 1.3   # the peak must beat the runner-up by this factor
MARGIN = .2           # and sit at least this far from every edge (as a fraction of the picture)
MANIFEST = 'images/bhavacakra/manifest.json'


def load_gray(path):
    """The picture as rows of grey levels, via a temporary bitmap (transparent parts sit over mid grey, so they carry no edges)."""
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, 'picture.bmp')
        subprocess.run(['sips', '-s', 'format', 'bmp', '-Z', str(SIZE), path, '--out', out], check=True, capture_output=True)
        data = open(out, 'rb').read()
    offset, = struct.unpack_from('<I', data, 10)
    width, height = struct.unpack_from('<ii', data, 18)
    bits, = struct.unpack_from('<H', data, 28)
    assert bits in (24, 32), 'unexpected bitmap depth %d' % bits
    top_down, height = height < 0, abs(height)
    step = bits // 8
    stride = (width * step + 3) & ~3
    gray = []
    for y in range(height):
        row = offset + (y if top_down else height - 1 - y) * stride
        line = []
        for x in range(width):
            b, g, r = data[row + step * x], data[row + step * x + 1], data[row + step * x + 2]
            if step == 4:
                alpha = data[row + step * x + 3] / 255
                r, g, b = r * alpha + 128 * (1 - alpha), g * alpha + 128 * (1 - alpha), b * alpha + 128 * (1 - alpha)
            line.append(.299 * r + .587 * g + .114 * b)
        gray.append(line)
    return gray, width, height


def box_blur(grid, width, height, radius):
    horizontal = [[0.0] * width for _ in range(height)]
    for y in range(height):
        run, row = 0.0, grid[y]
        for x in range(-radius, width + radius):
            if x + radius < width: run += row[x + radius]
            if x - radius - 1 >= 0: run -= row[x - radius - 1]
            if 0 <= x < width: horizontal[y][x] = run
    out = [[0.0] * width for _ in range(height)]
    for x in range(width):
        run = 0.0
        for y in range(-radius, height + radius):
            if y + radius < height: run += horizontal[y + radius][x]
            if y - radius - 1 >= 0: run -= horizontal[y - radius - 1][x]
            if 0 <= y < height: out[y][x] = run
    return out


def find_centre(gray, width, height):
    """(x, y) of the strongest radial-symmetry point, in pixels, and how much it dominates the runner-up."""
    edges, magnitudes = {}, []
    for y in range(1, height - 1):
        for x in range(1, width - 1):
            gx = (gray[y - 1][x + 1] + 2 * gray[y][x + 1] + gray[y + 1][x + 1]) - (gray[y - 1][x - 1] + 2 * gray[y][x - 1] + gray[y + 1][x - 1])
            gy = (gray[y + 1][x - 1] + 2 * gray[y + 1][x] + gray[y + 1][x + 1]) - (gray[y - 1][x - 1] + 2 * gray[y - 1][x] + gray[y - 1][x + 1])
            magnitude = math.hypot(gx, gy)
            edges[(x, y)] = (gx, gy, magnitude)
            magnitudes.append(magnitude)
    magnitudes.sort()
    cut = magnitudes[int(len(magnitudes) * .65)]
    strong = [(x, y, gx / m, gy / m, m) for (x, y), (gx, gy, m) in edges.items() if m > cut and m > 8]
    short = min(width, height)
    accumulator = [[0.0] * width for _ in range(height)]
    for radius in sorted({max(3, round(short * f)) for f in (.06, .10, .15, .21, .28, .36, .45)}):
        votes = [[0.0] * width for _ in range(height)]
        for x, y, ux, uy, m in strong:
            for sign in (1, -1):   # a circle may be lighter or darker than its surroundings
                px, py = int(round(x + sign * ux * radius)), int(round(y + sign * uy * radius))
                if 0 <= px < width and 0 <= py < height: votes[py][px] += m
        peak = max(max(row) for row in votes) or 1.0
        for y in range(height):
            for x in range(width):
                accumulator[y][x] += (votes[y][x] / peak) ** 2   # every scale counts equally; peaks count more
    smooth = box_blur(box_blur(accumulator, width, height, 2), width, height, 2)
    best, bx, by = -1.0, 0, 0
    for y in range(height):
        for x in range(width):
            if smooth[y][x] > best: best, bx, by = smooth[y][x], x, y
    second = max((smooth[y][x] for y in range(height) for x in range(width) if math.hypot(x - bx, y - by) > short * .2), default=0)
    return bx, by, best / (second or 1)


def main():
    dry = '--dry-run' in sys.argv
    manifest = json.load(open(MANIFEST))
    kept = 0
    for entry in manifest:
        gray, width, height = load_gray(entry['thumb'])
        x, y, dominance = find_centre(gray, width, height)
        cx, cy = (x + .5) / width, (y + .5) / height
        trusted = dominance >= MIN_DOMINANCE and MARGIN <= cx <= 1 - MARGIN and MARGIN <= cy <= 1 - MARGIN
        if trusted: entry['center'] = [round(cx, 3), round(cy, 3)]; kept += 1
        else: entry.pop('center', None)
        print('%-24s %s  dominance %.2f%s' % (os.path.basename(entry['src']), '(%.3f, %.3f)' % (cx, cy), dominance, '' if trusted else '  -> not trusted, the page uses the middle'))
    print('%d of %d pictures have a trusted centre' % (kept, len(manifest)))
    if not dry:
        text = json.dumps(manifest, indent=2)   # same escaping as before, so only the new "center" lines differ
        text = re.sub(r'\[\s+([\d.]+),\s+([\d.]+)\s+\]', r'[\1, \2]', text)
        with open(MANIFEST, 'w') as f:
            f.write(text + '\n')


if __name__ == '__main__':
    main()
