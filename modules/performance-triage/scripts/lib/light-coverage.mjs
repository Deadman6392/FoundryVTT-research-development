/**
 * How much of a scene its lights cover, and how many times over.
 *
 * Foundry draws every light as its own mesh on each lighting layer (illumination, coloration, background), over the
 * polygon the light reaches after walls clip it, on every frame; meshes off screen are culled. So lighting costs GPU
 * time in proportion to the screen area lights cover, counted once per overlapping light, not to the number of lights:
 * twenty candles in separate rooms cost less than three lights that fill the same hall.
 * Pure, so it can be tested in Node.
 */

/** Area of a polygon given as a flat [x0, y0, x1, y1, ...] list (shoelace formula). */
export function polygonArea(points) {
  let twice = 0;
  const n = points.length;
  for ( let i = 0; i < n; i += 2 ) {
    const j = (i + 2) % n;
    twice += (points[i] * points[j + 1]) - (points[j] * points[i + 1]);
  }
  return Math.abs(twice) / 2;
}

/** Whether a point is inside a polygon given as a flat list (even-odd rule). */
export function polygonContains(points, x, y) {
  let inside = false;
  const n = points.length;
  for ( let i = 0, j = n - 2; i < n; j = i, i += 2 ) {
    const xi = points[i];
    const yi = points[i + 1];
    const xj = points[j];
    const yj = points[j + 1];
    if ( ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi) / (yj - yi)) + xi) ) inside = !inside;
  }
  return inside;
}

function boundsOf(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for ( let i = 0; i < points.length; i += 2 ) {
    if ( points[i] < minX ) minX = points[i];
    if ( points[i] > maxX ) maxX = points[i];
    if ( points[i + 1] < minY ) minY = points[i + 1];
    if ( points[i + 1] > maxY ) maxY = points[i + 1];
  }
  return { minX, minY, maxX, maxY };
}

/**
 * @typedef {object} LightShape
 * @property {string} id
 * @property {"light"|"token"} kind   An ambient light, or a light carried by a token
 * @property {string} [name]          The token's name, for token lights
 * @property {number} radius          In pixels
 * @property {boolean} walls          Whether walls clip the light
 * @property {number[]} points        The light's polygon after walls, as a flat list
 */

/**
 * Measure light coverage on a scene.
 * @param {LightShape[]} lights
 * @param {{x: number, y: number, width: number, height: number}} rect  The scene's area, without padding
 * @param {object} [options]
 * @param {number} [options.samples]  About how many points of the scene to test for overlap
 * @param {number} [options.top]      How many of the largest lights to list
 * @returns {{count: number, cover: number, lit: number, overlap: number, unwalled: number, largest: object[]}|null}
 *   cover: the lights' total area as a multiple of the scene's (2 means they paint the scene twice over);
 *   lit: the share of the scene at least one light reaches; overlap: how many lights reach a lit point on average.
 *   Each of the largest lights has `share` (of all light area), `cover` (of the scene) and `overlap` (other lights
 *   reaching the same points, on average).
 */
export function lightCoverage(lights, rect, { samples = 12000, top = 5 } = {}) {
  const sceneArea = rect.width * rect.height;
  if ( !(sceneArea > 0) ) return null;
  const items = lights.filter(l => (l.points?.length ?? 0) >= 6).map(l => ({
    ...l, area: polygonArea(l.points), box: boundsOf(l.points), hits: 0, others: 0
  }));
  const lightArea = items.reduce((a, l) => a + l.area, 0);

  // Test a grid of points across the scene; a light's bounding box rules most lights out before the polygon test
  const step = Math.sqrt(sceneArea / samples);
  let tested = 0;
  let lit = 0;
  let layers = 0;
  const here = [];
  for ( let y = rect.y + (step / 2); y < rect.y + rect.height; y += step ) {
    for ( let x = rect.x + (step / 2); x < rect.x + rect.width; x += step ) {
      tested++;
      here.length = 0;
      for ( const l of items ) {
        const b = l.box;
        if ( (x < b.minX) || (x > b.maxX) || (y < b.minY) || (y > b.maxY) ) continue;
        if ( polygonContains(l.points, x, y) ) here.push(l);
      }
      if ( !here.length ) continue;
      lit++;
      layers += here.length;
      for ( const l of here ) {
        l.hits++;
        l.others += here.length - 1;
      }
    }
  }

  const round = (v, d = 2) => Math.round(v * (10 ** d)) / (10 ** d);
  return {
    count: items.length,
    cover: round(lightArea / sceneArea),
    lit: tested ? round(lit / tested) : 0,
    overlap: lit ? round(layers / lit, 1) : 0,
    unwalled: items.filter(l => l.walls === false).length,
    largest: [...items].sort((a, b) => b.area - a.area).slice(0, top).map(l => ({
      id: l.id,
      kind: l.kind,
      name: l.name ?? "",
      radius: Math.round(l.radius ?? 0),
      walls: l.walls !== false,
      share: lightArea ? round(l.area / lightArea) : 0,
      cover: round(l.area / sceneArea, 3),
      overlap: l.hits ? round(l.others / l.hits, 1) : 0
    }))
  };
}
