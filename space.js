// Uzay görünümü: haritadan uzaklaşınca açılan Güneş Sistemi. Sadece açıldığında yüklenir (three.js, dokular),
// böylece haritanın açılışı ağırlaşmaz. Gezegenler bugünkü gerçek konumlarında; tıklanan gök cismine yaklaşılır,
// fareyle/parmakla döndürülür ve yakınlaştırılır. Üzerlerindeki önemli yerler (iniş noktaları vb.) işaretlidir.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { UI, BODIES, LANDMARKS, SUN_TIMELINE } from './space-data.js';
import { EXTRAS } from './space-extras.js';

const DEG = Math.PI / 180;
const TEX = 'assets/planets/';
const OVERVIEW = { pos: new THREE.Vector3(0, 50, 86), target: new THREE.Vector3(0, 0, 0) };

let root, renderer, labels, scene, camera, controls, card, ambient, raf = 0, open = false, onExit = null, shift = 0;
let lang = 'tr', U = UI.tr, focused = null, tween = null;
const bodies = new Map(); // key → { def, group, mesh, label, marks: [] }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tr = (o) => (o && (o[lang] ?? o.en)) || '';
const num = (n, d = 0) => n.toLocaleString(lang === 'ku' ? 'tr' : lang, { maximumFractionDigits: d });

// ---------------- Konumlar ----------------
// Bugünkü güneş merkezli boylam: Kepler denklemi JPL'nin yaklaşık öğeleriyle çözülür (1800–2050 için yeterli).
function helioLongitude(el, T) {
  const L = el.L[0] + el.L[1] * T, w = el.w[0] + el.w[1] * T, e = el.e[0] + el.e[1] * T;
  const M = (((L - w) % 360) + 360) % 360 * DEG;
  let E = M;
  for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  return nu + w * DEG;
}
const onEcliptic = (r, lon) => new THREE.Vector3(r * Math.cos(lon), 0, -r * Math.sin(lon));
// Doku haritalarında boylam 0 ortada: enlem/boylam küre üzerindeki noktaya çevrilir.
const onSphere = (r, lat, lon) => new THREE.Vector3(r * Math.cos(lat * DEG) * Math.cos(lon * DEG), r * Math.sin(lat * DEG), -r * Math.cos(lat * DEG) * Math.sin(lon * DEG));

// ---------------- Sahne ----------------
function glowTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.25, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function build() {
  root = document.createElement('div');
  root.id = 'space';
  root.innerHTML = `
    <div class="sp-stage"></div>
    <div class="sp-bar">
      <button type="button" data-act="overview"><i class="ti ti-sun"></i><span></span></button>
      <button type="button" data-act="map" class="primary"><i class="ti ti-world"></i><span></span></button>
    </div>
    <div class="sp-chips"></div>
    <aside class="sp-card" hidden></aside>
    <div class="sp-hint"></div>
    <div class="sp-credit"></div>`;
  document.body.appendChild(root);
  card = root.querySelector('.sp-card');

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  root.querySelector('.sp-stage').appendChild(renderer.domElement);
  labels = new CSS2DRenderer();
  labels.domElement.className = 'sp-labels';
  root.querySelector('.sp-stage').appendChild(labels.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, 1, 0.05, 3000);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;

  const loader = new THREE.TextureLoader();
  const tex = (name) => { const t = loader.load(TEX + name + '.jpg'); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };

  // Arka plan: Samanyolu ile yıldızlı gökyüzü.
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 32), new THREE.MeshBasicMaterial({ map: tex('stars_milky_way'), side: THREE.BackSide, color: 0x9a9a9a }));
  scene.add(sky);
  ambient = new THREE.AmbientLight(0xffffff, 0.12);
  scene.add(ambient);
  scene.add(new THREE.PointLight(0xffffff, 3.2, 0, 0));

  const T = (Date.now() / 86400000 + 2440587.5 - 2451545) / 36525; // J2000'den beri geçen yüzyıl
  for (const def of BODIES) {
    const group = new THREE.Group();          // gök cisminin merkezi
    const tilt = new THREE.Group();           // eksen eğikliği
    tilt.rotation.z = def.tilt * DEG;
    group.add(tilt);
    const isSun = def.key === 'sun';
    const mat = isSun ? new THREE.MeshBasicMaterial({ map: tex(def.tex) }) : new THREE.MeshStandardMaterial({ map: tex(def.tex), roughness: 1, metalness: 0 });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(def.r, 64, 48), mat);
    mesh.userData.key = def.key;
    tilt.add(mesh);

    if (isSun) {
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,200,80,0.9)', 'rgba(255,120,0,0)'), blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.set(def.r * 5, def.r * 5, 1);
      group.add(glow);
    }
    if (def.ring) {
      // Halka dokusu yarıçap boyunca uzanır: UV'ler içten dışa doğru yeniden dağıtılır.
      const geo = new THREE.RingGeometry(def.ring[0], def.ring[1], 128, 1);
      const pos = geo.attributes.position, uv = geo.attributes.uv, v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        uv.setXY(i, (v.length() - def.ring[0]) / (def.ring[1] - def.ring[0]), 0.5);
      }
      const ringTex = loader.load(TEX + 'saturn_ring.png');
      ringTex.colorSpace = THREE.SRGBColorSpace;
      const ring = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, side: THREE.DoubleSide, opacity: 0.95 }));
      ring.rotation.x = -Math.PI / 2;
      tilt.add(ring);
    }

    // Konum: Ay Dünya'nın çevresinde, gezegenler Güneş'in çevresinde (bugünkü yerleri).
    if (def.parent) {
      const d = Date.now() / 86400000 + 2440587.5 - 2451545;
      group.position.copy(onEcliptic(def.orbit, (218.316 + 13.176396 * d) * DEG));
      bodies.get(def.parent).group.add(group);
    } else {
      if (def.el) group.position.copy(onEcliptic(def.dist, helioLongitude(def.el, T)));
      scene.add(group);
      if (def.dist) {
        const pts = [];
        for (let i = 0; i <= 256; i++) pts.push(onEcliptic(def.dist, (i / 256) * Math.PI * 2));
        const orbit = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x5a6a88, transparent: true, opacity: 0.35 }));
        scene.add(orbit);
      }
    }

    // Ad etiketi: tıklayınca o gök cismine gidilir.
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'sp-label' + (def.key === 'earth' ? ' earth' : '');
    el.addEventListener('click', (ev) => { ev.stopPropagation(); focus(def.key); });
    const label = new CSS2DObject(el);
    label.position.set(0, def.r * 1.25 + 0.3, 0);
    group.add(label);

    // Önemli yerler: gök cismiyle birlikte dönen küçük işaretler.
    const marks = LANDMARKS.filter((m) => m.body === def.key).map((m) => {
      const me = document.createElement('button');
      me.type = 'button';
      me.className = 'sp-mark';
      me.innerHTML = `<i class="ti ti-${m.icon}"></i><span></span>`;
      me.addEventListener('click', (ev) => { ev.stopPropagation(); showLandmark(m); });
      const obj = new CSS2DObject(me);
      obj.position.copy(onSphere(def.r * 1.01, m.lat, m.lon));
      obj.visible = false;
      mesh.add(obj);
      return { def: m, obj, el: me };
    });
    bodies.set(def.key, { def, group, mesh, label, labelEl: el, marks });
  }

  buildExtras();

  // Tıklama ile seçim (sürükleme sayılmaz).
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const r = renderer.domElement.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects([...bodies.values()].map((b) => b.mesh))[0];
    if (hit) focus(hit.object.userData.key);
  });
  root.querySelector('.sp-chips').addEventListener('click', (e) => {
    const key = e.target.closest('[data-go]')?.dataset.go;
    if (key) bodies.get(key)?.def.kind === 'belt' ? showBody(key) : focus(key);
  });
  root.querySelector('.sp-bar').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'overview') overview();
    if (act === 'map') exitToMap();
  });
  card.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mark],[data-act]');
    if (!b) return;
    if (b.dataset.act === 'map') exitToMap();
    if (b.dataset.act === 'back') showBody(focused);
    if (b.dataset.mark != null) showLandmark(LANDMARKS[+b.dataset.mark]);
  });
  addEventListener('resize', resize);
  resize();
}

// ---------------- Güneş Sistemi'ndeki trafik ----------------
// Asteroit ve Kuiper kuşakları dönen parçacıklar olarak; kuyruklu yıldız Güneş'e yaklaşınca uzayan kuyruğuyla;
// uzay araçları (ISS, James Webb, Parker, Voyager 1-2, New Horizons) ve Samanyolu'nun merkezindeki kara delik
// tıklanabilir; arka planda zaman zaman kayan yıldızlar geçer.
const onSky = (r, lon, lat) => new THREE.Vector3(r * Math.cos(lat * DEG) * Math.cos(lon * DEG), r * Math.sin(lat * DEG), -r * Math.cos(lat * DEG) * Math.sin(lon * DEG));
const updaters = [];
// Kuşaklar iki katmandır: uzaktan ince bir toz gibi görünen noktalar ve yaklaşınca seçilen gerçek 3B kayalar.
const DUST_MAX_PX = 2;
function beltDust(count, rMin, rMax, height, color, size) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2, r = rMin + Math.random() * (rMax - rMin);
    pos.set([r * Math.cos(a), (Math.random() - 0.5) * height, -r * Math.sin(a)], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color, size, sizeAttenuation: true, transparent: true, opacity: 0.85, depthWrite: false });
  // Kamera kuşağın içine girince noktalar büyümesin: ekrandaki boyutları sınırlıdır.
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <fog_vertex>', `#include <fog_vertex>
      gl_PointSize = min(gl_PointSize, ${(DUST_MAX_PX * devicePixelRatio).toFixed(1)});`);
  };
  return new THREE.Points(geo, mat);
}
// Girintili çıkıntılı kaya: küre yüzeyi yöne bağlı dalgalarla bozulur, normaller köşelerde birleşerek yüzey yumuşak görünür.
function rockGeometry(detail) {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const waves = Array.from({ length: 6 }, (_, i) => ({
    dir: new THREE.Vector3().randomDirection(), freq: 1.6 + i * 1.8, phase: Math.random() * 6.28, amp: 0.3 / (1 + i * 0.8),
  }));
  const pos = geo.attributes.position, v = new THREE.Vector3(), keys = [];
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    keys.push(`${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`);
    let k = 1;
    for (const w of waves) k += Math.sin(v.dot(w.dir) * w.freq + w.phase) * w.amp;
    v.multiplyScalar(Math.max(k, 0.45));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const nor = geo.attributes.normal, sum = new Map();
  for (let i = 0; i < nor.count; i++) {
    const n = sum.get(keys[i]) || new THREE.Vector3();
    sum.set(keys[i], n.add(v.fromBufferAttribute(nor, i)));
  }
  for (let i = 0; i < nor.count; i++) {
    const n = sum.get(keys[i]).clone().normalize();
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  return geo;
}
// Yüzey, Ay dokusundan gelir: kraterli gerçek kaya görünümü. Büyük kayalar daha ince işlenir.
let rockSurface = null;
function beltRocks(count, rMin, rMax, height, color, sizeMin, sizeMax) {
  if (!rockSurface) {
    rockSurface = new THREE.TextureLoader().load(TEX + 'moon.jpg');
    rockSurface.colorSpace = THREE.SRGBColorSpace;
    rockSurface.wrapS = rockSurface.wrapT = THREE.RepeatWrapping;
  }
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ map: rockSurface, bumpMap: rockSurface, bumpScale: 2.5, roughness: 1, metalness: 0 });
  const base = new THREE.Color(color), tint = new THREE.Color(), m = new THREE.Matrix4();
  const q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const big = Math.ceil(count * 0.08), kinds = [[3, big, 0.5, 1], [2, count - big, 0, 0.5], [2, count - big, 0, 0.5]];
  for (const [detail, total, lo, hi] of kinds) {
    const mesh = new THREE.InstancedMesh(rockGeometry(detail), mat, detail === 3 ? total : Math.ceil(total / 2));
    for (let i = 0; i < mesh.count; i++) {
      const a = Math.random() * Math.PI * 2, r = rMin + Math.random() * (rMax - rMin);
      p.set(r * Math.cos(a), (Math.random() - 0.5) * height, -r * Math.sin(a));
      q.setFromEuler(e.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28));
      // Çoğu kaya küçük, azı büyük; hiçbiri tam yuvarlak değil.
      const size = sizeMin + (sizeMax - sizeMin) * (lo + (hi - lo) * Math.random() ** 2);
      sc.set(size, size * (0.55 + Math.random() * 0.4), size * (0.65 + Math.random() * 0.5));
      mesh.setMatrixAt(i, m.compose(p, q, sc));
      mesh.setColorAt(i, tint.copy(base).multiplyScalar(1.1 + Math.random() * 0.7));
    }
    group.add(mesh);
  }
  return group;
}
// Uzay araçları NASA'nın kendi 3D modelleridir (NASA 3D Resources, assets/craft). Model, istenen boyuta getirilip
// ortalanır; Güneş'e uzak araçlar da görünsün diye kendi dokusu hafifçe aydınlatılır.
const gltfLoader = new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/libs/draco/gltf/'));
function loadCraft(group, file, size, prepare) {
  gltfLoader.load(`assets/craft/${file}`, ({ scene: model }) => {
    prepare?.(model);
    const box = new THREE.Box3().setFromObject(model);
    const dim = box.getSize(new THREE.Vector3());
    model.scale.setScalar(size / Math.max(dim.x, dim.y, dim.z));
    model.position.copy(box.getCenter(new THREE.Vector3()).multiplyScalar(-model.scale.x));
    model.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material = o.material.clone();
      if (m.emissive && !m.vertexColors) { m.emissive.copy(m.color); m.emissiveMap = m.map; m.emissiveIntensity = 0.22; }
    });
    group.add(model);
  });
}
// NASA'nın istasyon modeli tek renk gri: fotoğraftaki gibi boyanır. Model dosyasında istasyonun çok uzağında duran
// başıboş diskler de çıkarılır.
const ISS_COLORS = { anisotropic1SG: 0xd5d8dc, apollohorns_blin: 0xc4c8ce, lambert3SG: 0xeef0f2, lambert4SG: 0xf5f6f7, blinn1SG: 0xe6e8ea, blinn3SG: 0xdcdfe2, blinn4SG: 0xd9a24a, blinn5SG: 0xe6e8ea, lambert6SG: 0xb9bdc4, soyuz_blinn4SG: 0x8d9299 };
const ISS_ARRAY_TOP = new THREE.Color(0x34324a), ISS_ARRAY_BOTTOM = new THREE.Color(0xd9822b);
function paintIss(model) {
  const stray = [];
  model.traverse((o) => { if (/^(bendedtru|pCylinder)/.test(o.name)) stray.push(o); });
  for (const o of stray) o.parent.remove(o);
  model.traverse((o) => {
    if (!o.isMesh) return;
    const name = o.material.name.replace(/\.\d+$/, '');
    if (name === 'lambert7SG') {
      // Güneş panelleri: fotoğraftaki gibi merkezin bir yanı koyu, öbür yanı turuncu-bakır.
      const pos = o.geometry.attributes.position, colors = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) (pos.getY(i) > 10.9 ? ISS_ARRAY_TOP : ISS_ARRAY_BOTTOM).toArray(colors, i * 3);
      o.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      o.material = o.material.clone();
      o.material.color.set(0xffffff);
      o.material.vertexColors = true;
      o.material.metalness = 0.3;
      o.material.roughness = 0.45;
    } else if (ISS_COLORS[name]) {
      o.material = o.material.clone();
      o.material.color.set(ISS_COLORS[name]);
    }
  });
}
function addExtra(def, group, opts = {}) {
  // Küçük cisimlere tıklamak kolay olsun diye görünmez, daha büyük bir tıklama küresi eklenir.
  const r = opts.r ?? 0.3;
  const hit = new THREE.Mesh(new THREE.SphereGeometry(opts.hit ?? Math.max(r, 0.6), 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
  hit.userData.key = def.key;
  group.add(hit);
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `sp-label sp-extra sp-${def.kind}`;
  el.addEventListener('click', (ev) => { ev.stopPropagation(); def.kind === 'belt' ? showBody(def.key) : focus(def.key); });
  const label = new CSS2DObject(el);
  label.position.set(0, opts.labelY ?? r * 1.6 + 0.4, 0);
  group.add(label);
  bodies.set(def.key, { def: { ...def, r, moving: !!opts.moving, view: opts.view, extra: true }, group, mesh: hit, label, labelEl: el, marks: [] });
}

function buildExtras() {
  const byKey = Object.fromEntries(EXTRAS.map((d) => [d.key, d]));
  const earth = bodies.get('earth').group;

  // Asteroit kuşağı (Mars–Jüpiter) ve Kuiper kuşağı (Neptün'ün ötesi): yavaşça dönen toz ve kayalar.
  const belt = new THREE.Group(), kuiper = new THREE.Group();
  belt.add(beltDust(3500, 33.5, 40, 1.4, 0xb9a98f, 0.16), beltRocks(500, 33.5, 40, 1.4, 0xa8967c, 0.015, 0.16));
  kuiper.add(beltDust(2600, 86, 104, 6, 0x9fb7d6, 0.28), beltRocks(300, 86, 104, 6, 0x9fb0c8, 0.03, 0.28));
  scene.add(belt, kuiper);
  updaters.push((dt) => { belt.rotation.y += dt * 0.012; kuiper.rotation.y += dt * 0.004; });
  for (const [key, dist, lon] of [['belt', 37, 20], ['kuiper', 96, 200]]) {
    const g = new THREE.Group();
    g.position.copy(onEcliptic(dist, lon * DEG));
    scene.add(g);
    addExtra(byKey[key], g, { r: 0.5, hit: 1.5, labelY: 1.2 });
  }

  // Uluslararası Uzay İstasyonu: Dünya'nın çevresinde hızlı tur.
  const iss = new THREE.Group();
  loadCraft(iss, 'iss.glb', 0.3, paintIss);
  earth.add(iss);
  addExtra(byKey.iss, iss, { r: 0.08, hit: 0.25, moving: true, labelY: 0.25, view: 0.55 });
  let issA = 0;
  updaters.push((dt) => { issA += dt * 0.6; iss.position.set(Math.cos(issA) * 1.35, Math.sin(issA) * 0.45, -Math.sin(issA) * 1.35); });

  // James Webb: Güneş–Dünya L2 noktasında, Dünya'nın Güneş'e ters tarafında.
  const jwst = new THREE.Group();
  loadCraft(jwst, 'jwst.glb', 0.4);
  jwst.position.copy(earth.position.clone().normalize().multiplyScalar(2.8));
  earth.add(jwst);
  addExtra(byKey.jwst, jwst, { r: 0.12, hit: 0.3, labelY: 0.3, view: 0.7 });

  // Parker Güneş Sondası: Güneş'in hemen yanında, basık ve hızlı bir yörünge.
  const parker = new THREE.Group();
  loadCraft(parker, 'parker.glb', 0.6);
  scene.add(parker);
  addExtra(byKey.parker, parker, { r: 0.3, hit: 0.6, moving: true, labelY: 0.5, view: 1.1 });
  let parkerT = 0;
  updaters.push((dt) => {
    parkerT += dt * 0.35;
    const a = 6.6, e = 0.55, E = parkerT, rr = a * (1 - e * Math.cos(E));
    const v = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
    parker.position.set(rr * Math.cos(v + 1), 0.2, -rr * Math.sin(v + 1));
    parker.lookAt(0, 0, 0);
  });

  // Uzaktaki araçlar: Voyager 1-2 ve New Horizons gerçek yönlerinde, sistemin dışında.
  for (const key of ['voyager1', 'voyager2', 'newhorizons']) {
    const d = byKey[key];
    const g = new THREE.Group();
    if (key === 'newhorizons') {
      // New Horizons'ın 3D modeli yok: NASA'nın saydam zeminli görseli kameraya dönük durur.
      const tex = new THREE.TextureLoader().load('assets/craft/newhorizons.png');
      tex.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      sprite.scale.set(1.9, 1.9, 1);
      g.add(sprite);
    } else loadCraft(g, 'voyager.glb', 2);
    g.position.copy(onSky(d.dist, d.lon, d.lat));
    scene.add(g);
    // Güneş'ten araca uzanan ince, kesikli yol: aracın sistemin dışına çıktığı yön.
    const path = new THREE.Line(new THREE.BufferGeometry().setFromPoints([onSky(20, d.lon, d.lat * 0.2), g.position.clone()]),
      new THREE.LineDashedMaterial({ color: 0x6f86b0, dashSize: 2, gapSize: 2, transparent: true, opacity: 0.45 }));
    path.computeLineDistances();
    scene.add(path);
    addExtra(d, g, { r: 0.6, hit: 2, labelY: 1.4, view: 3 });
  }

  // Kuyruklu yıldız: basık, eğik bir yörüngede; kuyruğu her zaman Güneş'in ters yönüne uzanır ve Güneş'e yaklaştıkça uzar.
  const comet = new THREE.Group();
  comet.add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), new THREE.MeshBasicMaterial({ color: 0xe6f6ff })));
  const coma = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(190,235,255,0.95)', 'rgba(120,190,255,0)'), blending: THREE.AdditiveBlending, depthWrite: false }));
  coma.scale.set(2.4, 2.4, 1);
  comet.add(coma);
  scene.add(comet);
  const TAIL = 260;
  const tailPos = new Float32Array(TAIL * 3), tailCol = new Float32Array(TAIL * 3);
  const tailGeo = new THREE.BufferGeometry();
  tailGeo.setAttribute('position', new THREE.BufferAttribute(tailPos, 3));
  tailGeo.setAttribute('color', new THREE.BufferAttribute(tailCol, 3));
  const tail = new THREE.Points(tailGeo, new THREE.PointsMaterial({ size: 1.6, map: glowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)'), vertexColors: true, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
  tail.frustumCulled = false; // noktalar her karede yer değiştirir; ilk ölçülen sınırlara göre gizlenmesin
  scene.add(tail);
  const jitter = Array.from({ length: TAIL }, () => [Math.random(), (Math.random() - 0.5), (Math.random() - 0.5)]);
  addExtra(byKey.comet, comet, { r: 0.4, hit: 1.2, moving: true, labelY: 1.2, view: 22 });
  const tilt = new THREE.Euler(18 * DEG, 0, 30 * DEG);
  let cometT = 0;
  updaters.push((dt) => {
    cometT += dt * 0.07;
    const a = 58, e = 0.86;
    let E = cometT % (Math.PI * 2);
    for (let i = 0; i < 6; i++) E -= (E - e * Math.sin(E) - (cometT % (Math.PI * 2))) / (1 - e * Math.cos(E));
    const x = a * (Math.cos(E) - e), z = a * Math.sqrt(1 - e * e) * Math.sin(E);
    comet.position.set(x, 0, -z).applyEuler(tilt);
    const r = comet.position.length();
    const away = comet.position.clone().normalize();
    const len = Math.max(7, Math.min(30, 320 / Math.max(r, 6))); // Güneş'e yakınken kuyruk uzun
    const side = new THREE.Vector3(0, 1, 0).cross(away).normalize();
    for (let i = 0; i < TAIL; i++) {
      const [k, s1, s2] = jitter[i];
      const p = comet.position.clone().addScaledVector(away, k * len).addScaledVector(side, s1 * k * len * 0.22).add(new THREE.Vector3(0, s2 * k * len * 0.14, 0));
      tailPos.set([p.x, p.y, p.z], i * 3);
      const f = 1 - k;
      // Başa yakın parlak mavi-beyaz, uca doğru sönük (toplanınca beyaza patlamasın diye kısık).
      tailCol.set([0.18 * f + 0.02, 0.28 * f + 0.03, 0.4 * f + 0.06], i * 3);
    }
    tailGeo.attributes.position.needsUpdate = true;
    tailGeo.attributes.color.needsUpdate = true;
  });

  // Kara delik: Samanyolu'nun merkezi yönünde; karanlık çekirdek, dönen sıcak toplanma diski ve foton halkası.
  const bh = byKey.blackhole;
  const hole = new THREE.Group();
  hole.position.copy(onSky(bh.dist, bh.lon, bh.lat));
  const core = new THREE.Mesh(new THREE.SphereGeometry(5, 32, 24), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  const diskTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(256, 256, 70, 256, 256, 256);
    grad.addColorStop(0, 'rgba(255,250,230,1)');
    grad.addColorStop(0.18, 'rgba(255,200,90,0.95)');
    grad.addColorStop(0.45, 'rgba(255,110,30,0.7)');
    grad.addColorStop(0.75, 'rgba(160,40,20,0.3)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 512);
    // Diskte dönen sıcak gaz izleri.
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 90; i++) {
      g.strokeStyle = `rgba(255,${150 + Math.random() * 90},${60 + Math.random() * 60},${0.05 + Math.random() * 0.12})`;
      g.lineWidth = 1 + Math.random() * 3;
      const rr = 80 + Math.random() * 160, a0 = Math.random() * Math.PI * 2;
      g.beginPath();
      g.arc(256, 256, rr, a0, a0 + 0.4 + Math.random() * 1.2);
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const disk = new THREE.Mesh(new THREE.RingGeometry(5.6, 24, 96, 1), new THREE.MeshBasicMaterial({ map: diskTex, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  // RingGeometry UV'si kare dokuyu doğrudan eşler; disk hafif eğik durur.
  disk.rotation.x = -Math.PI / 2 + 0.35;
  const photon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,220,150,0)', 'rgba(255,170,60,0)'), blending: THREE.AdditiveBlending, depthWrite: false }));
  const ringTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(128, 128, 40, 128, 128, 128);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.3, 'rgba(255,220,160,0.95)');
    grad.addColorStop(0.42, 'rgba(255,150,60,0.45)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  photon.material.map = ringTex;
  photon.scale.set(19, 19, 1);
  hole.add(disk, photon, core);
  scene.add(hole);
  updaters.push((dt) => { disk.rotation.z += dt * 0.25; });
  addExtra(bh, hole, { r: 5, hit: 9, labelY: 15, view: 62 });

  // Kayan yıldızlar: arka planda ara ara geçen kısa, sönen ışık çizgileri.
  const meteors = [];
  let nextMeteor = 1.5;
  updaters.push((dt) => {
    nextMeteor -= dt;
    if (nextMeteor <= 0) {
      nextMeteor = 1.2 + Math.random() * 2.8;
      const from = new THREE.Vector3().randomDirection().multiplyScalar(700);
      const dir = new THREE.Vector3().randomDirection().cross(from).normalize();
      const geo = new THREE.BufferGeometry().setFromPoints([from, from.clone()]);
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array([1, 1, 1, 0.1, 0.15, 0.3]), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
      line.frustumCulled = false;
      scene.add(line);
      meteors.push({ line, from, dir, age: 0, life: 0.9 + Math.random() * 0.6, speed: 90 + Math.random() * 80 });
    }
    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i];
      m.age += dt;
      const head = m.from.clone().addScaledVector(m.dir, m.age * m.speed);
      const tailEnd = head.clone().addScaledVector(m.dir, -Math.min(45, m.age * m.speed));
      m.line.geometry.setFromPoints([head, tailEnd]);
      m.line.material.opacity = Math.max(0, 1 - m.age / m.life);
      if (m.age > m.life) { scene.remove(m.line); m.line.geometry.dispose(); meteors.splice(i, 1); }
    }
  });
}

function resize() {
  if (!renderer) return;
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  labels.setSize(w, h);
  camera.aspect = w / h;
  setOffset();
}
// shift > 0: sahne sola, shift < 0: sahne yukarı kayar.
function setOffset() {
  const w = innerWidth, h = innerHeight;
  if (!shift) camera.clearViewOffset();
  else if (shift > 0) camera.setViewOffset(w, h, shift, 0, w, h);
  else camera.setViewOffset(w, h, 0, -shift, w, h);
  camera.updateProjectionMatrix();
}

// ---------------- Kamera ----------------
const centerOf = (key) => bodies.get(key).group.getWorldPosition(new THREE.Vector3());
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
function flyTo(pos, target, ms = 1400, done) {
  tween = { from: camera.position.clone(), to: pos, tFrom: controls.target.clone(), tTo: target, start: performance.now(), ms, done };
  controls.enabled = false;
}

function overview() {
  focused = null;
  controls.minDistance = 8;
  controls.maxDistance = 420;
  flyTo(OVERVIEW.pos.clone(), OVERVIEW.target.clone(), 1600);
  card.hidden = true; card.innerHTML = '';
  updateLabels();
}

function focus(key) {
  const b = bodies.get(key);
  if (!b) return;
  focused = key;
  b.last = null; // hareket eden cisim (ISS, kuyruklu yıldız) izlenirken kamera onunla birlikte kayar
  const c = centerOf(key), r = b.def.r;
  // Kamera aydınlık tarafa, Güneş'e bakan yöne yerleşir (Güneş'te mevcut bakış yönü korunur).
  const toSun = c.clone().negate().normalize();
  // Kuyruklu yıldıza yandan bakılır (kuyruk Güneş'in ters yönünde uzandığı için önden görünmez).
  const dir = key === 'sun' ? camera.position.clone().sub(c).normalize()
    : key === 'comet' ? new THREE.Vector3(0, 1, 0).cross(toSun).normalize().add(new THREE.Vector3(0, 0.6, 0)).addScaledVector(toSun, 0.4).normalize()
    : toSun.add(new THREE.Vector3(0, 0.35, 0)).normalize();
  const dist = b.def.view ?? (key === 'sun' ? r * 4.2 : r * 3.4);
  controls.minDistance = r * 1.3;
  controls.maxDistance = Math.max(key === 'sun' ? r * 30 : r * 24, dist * 3);
  flyTo(c.clone().add(dir.multiplyScalar(dist)), c, 1500);
  showBody(key);
  updateLabels();
}

// Bir önemli yere tıklanınca kamera o noktanın tam üstüne döner.
function lookAtLandmark(m) {
  const b = bodies.get(m.body);
  const c = centerOf(m.body);
  const p = b.marks.find((x) => x.def === m).obj.getWorldPosition(new THREE.Vector3());
  flyTo(c.clone().add(p.sub(c).normalize().multiplyScalar(b.def.r * 2.6)), c, 1100);
}

// ---------------- Bilgi kartı ----------------
function factsHtml(def) {
  const f = def.facts, u = U.units;
  const dur = (x) => (x.y ? `${num(x.y, 2)} ${u.y}` : x.d ? `${num(x.d, 2)} ${u.d}` : `${x.h} ${u.h}${x.m ? ` ${x.m} ${u.m}` : ''}`);
  const rows = [[U.diameter, `${num(f.diameter)} ${u.km}`]];
  if (f.age) rows.push([U.age, `${num(f.age, 1)} ${u.by}`]);
  if (f.sun) rows.push([U.fromSun, `${num(f.sun, 1)} ${u.mkm}`]);
  if (f.earth) rows.push([U.fromEarth, `${num(f.earth)} ${u.km}`]);
  if (f.day) rows.push([U.day, dur(f.day)]);
  if (f.year) rows.push([U.year, dur(f.year)]);
  if (f.moons != null) rows.push([U.moons, num(f.moons)]);
  return `<dl class="sp-facts">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
}

// Bölgenin uydudan görüntüsü: EUMETSAT Meteosat (yaklaşık 10 dakikada bir). Sen'in İstasyon yayını YouTube'da açılır;
// gömülü oynatıcı YouTube'un "bot" engeline takıldığı için bağlantı olarak verilir.
const SAT_IMAGE = 'https://view.eumetsat.int/geoserver/wms?service=WMS&version=1.3.0&request=GetMap&layers=mtg_fd:rgb_geocolour&styles=&format=image/jpeg&crs=EPSG:4326&bbox=5,15,50,70&width=900&height=720';
const STREAM_LINK = 'https://www.youtube.com/channel/UCkvW_7kp9LJrztmgA4q4bJQ/live';
function streamHtml(def) {
  if (def.sunImage) {
    return `<p class="sp-note">${esc(U.parkerNote)}</p>
      <h3>${esc(U.sunNow)}</h3><img class="sp-sun-now" loading="lazy" alt="" src="https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_0193.jpg">`;
  }
  return `<h3>${esc(U.streamTitle)}</h3>
    <img class="sp-sun-now" loading="lazy" alt="" src="${SAT_IMAGE}">
    <p class="sp-note">${esc(U.streamBy)}</p>
    <a class="sp-go" href="${STREAM_LINK}" target="_blank" rel="noopener"><i class="ti ti-external-link"></i> ${esc(U.streamOpen)}</a>`;
}

function showBody(key) {
  const b = bodies.get(key);
  if (!b) return;
  const def = b.def;
  const marks = LANDMARKS.map((m, i) => [m, i]).filter(([m]) => m.body === key);
  let html = `<h2>${esc(tr(def.name))}</h2>${def.photo ? `<figure class="sp-hero"><img src="assets/craft/${def.photo}" alt=""><figcaption>NASA</figcaption></figure>` : ''}<p>${esc(tr(def.text))}</p>${def.facts ? factsHtml(def) : ''}`;
  if (key === 'earth') html += `<button type="button" class="sp-go" data-act="map"><i class="ti ti-map-2"></i> ${esc(U.toMap)}</button>`;
  if (def.stream) html += streamHtml(def);
  if (marks.length) {
    html += `<h3>${esc(U.landmarks)}</h3><ul class="sp-list">${marks.map(([m, i]) =>
      `<li><button type="button" data-mark="${i}"><i class="ti ti-${m.icon}"></i><span><b>${esc(tr(m.name))}</b>${m.year ? ` · ${m.year}` : ''}</span></button></li>`).join('')}</ul>`;
  }
  if (key === 'sun') {
    html += `<h3>${esc(U.live)}</h3><div class="sp-live">${esc(U.loading)}</div>`;
    html += `<h3>${esc(U.timeline)}</h3><ol class="sp-time">${SUN_TIMELINE.map((x) => `<li><b>${esc(tr(x.when))}</b><span>${esc(tr(x.text))}</span></li>`).join('')}</ol>`;
  }
  card.innerHTML = html;
  card.hidden = false;
  card.scrollTop = 0;
  if (key === 'sun') loadSolar();
}

function showLandmark(m) {
  if (focused !== m.body) focus(m.body);
  lookAtLandmark(m);
  card.innerHTML = `<button type="button" class="sp-back" data-act="back"><i class="ti ti-arrow-back-up"></i> ${esc(tr(bodies.get(m.body).def.name))}</button>
    <div class="sp-mark-head"><i class="ti ti-${m.icon}"></i><h2>${esc(tr(m.name))}</h2></div>
    ${m.year ? `<div class="sp-year">${m.year}</div>` : ''}
    <p>${esc(tr(m.text))}</p>
    <div class="sp-coord">${Math.abs(m.lat).toFixed(2)}° ${m.lat >= 0 ? 'N' : 'S'}, ${Math.abs(m.lon).toFixed(2)}° ${m.lon >= 0 ? 'E' : 'W'}</div>`;
  card.hidden = false;
  for (const x of bodies.get(m.body).marks) x.el.classList.toggle('active', x.def === m);
}

// Canlı Güneş etkinliği: NOAA Uzay Havası Merkezi'nin herkese açık verisi (anahtarsız, tarayıcıdan okunabilir).
let solar = null, solarAt = 0;
async function loadSolar() {
  const box = () => card.querySelector('.sp-live');
  try {
    if (!solar || Date.now() - solarAt > 10 * 60e3) {
      const [flares, kp] = await Promise.all([
        fetch('https://services.swpc.noaa.gov/json/goes/primary/xray-flares-7-day.json').then((r) => r.json()),
        fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json').then((r) => r.json()),
      ]);
      solar = { flares, kp };
      solarAt = Date.now();
    }
    if (!box()) return;
    // Patlama sınıfı: A < B < C < M < X, harften sonraki sayı şiddeti verir.
    const power = (c) => ({ A: 1, B: 10, C: 100, M: 1000, X: 10000 }[c?.[0]] || 0) * parseFloat(c?.slice(1) || 0);
    const top = solar.flares.filter((f) => f.max_class).sort((a, b) => power(b.max_class) - power(a.max_class)).slice(0, 5);
    const last = solar.kp[solar.kp.length - 1];
    const kpVal = parseFloat(Array.isArray(last) ? last[1] : last?.Kp ?? last?.kp_index);
    const kpWord = U.kpWords[kpVal >= 5 ? 2 : kpVal >= 4 ? 1 : 0];
    // Tarayıcılar Kurmancî ay adlarını bilmez: Kurmancîde tarih rakamla yazılır.
    const when = (t) => new Date(t).toLocaleString(lang === 'ku' ? 'tr' : lang, { day: 'numeric', month: lang === 'ku' ? 'numeric' : 'short', hour: '2-digit', minute: '2-digit' });
    box().innerHTML = `<div class="sp-kp k${kpVal >= 5 ? 2 : kpVal >= 4 ? 1 : 0}"><span>${esc(U.kp)}</span><b>${Number.isFinite(kpVal) ? kpVal.toFixed(1) : '—'} · ${esc(kpWord)}</b></div>
      <div class="sp-sub">${esc(U.flares)}</div>
      <ul class="sp-flares">${top.map((f) => `<li><b class="c${f.max_class[0]}">${esc(f.max_class)}</b><span>${esc(when(f.max_time))}</span></li>`).join('')}</ul>`;
  } catch {
    if (box()) box().textContent = U.noData;
  }
}

// ---------------- Etiketler ve dil ----------------
function updateLabels() {
  for (const b of bodies.values()) {
    b.labelEl.textContent = b.def.key === 'earth' ? `${tr(b.def.name)} · ${U.here}` : tr(b.def.name);
    // Bir gök cismine odaklanınca diğerlerinin adları gizlenir; Ay, Dünya'ya odaklanınca da görünür.
    // ISS ve James Webb Dünya'nın hemen yanında: sadece Dünya'ya yakınlaşınca görünür.
    // İstasyona bakarken arkada James Webb görünmesin (ölçek temsilî olduğu için çok yakın duruyor).
    if (b.def.key === 'jwst') b.group.visible = focused !== 'iss';
    if (b.def.key === 'iss') b.group.visible = focused !== 'jwst';
    const nearEarth = ['moon', 'iss', 'jwst'].includes(b.def.key);
    b.label.visible = focused ? focused === 'earth' && nearEarth : !['iss', 'jwst'].includes(b.def.key);
    for (const m of b.marks) m.el.querySelector('span').textContent = tr(m.def.name);
  }
}

function applyLang() {
  U = UI[lang] || UI.en;
  root.dir = lang === 'ckb' || lang === 'ar' ? 'rtl' : 'ltr';
  const [ov, mp] = root.querySelectorAll('.sp-bar button span');
  ov.textContent = U.overview;
  mp.textContent = U.toMap;
  root.querySelector('.sp-hint').textContent = `${U.hint} · ${U.today}`;
  root.querySelector('.sp-credit').textContent = U.credit;
  root.querySelector('.sp-chips').innerHTML = ['blackhole', 'comet', 'voyager1', 'voyager2', 'newhorizons', 'jwst', 'iss', 'parker', 'belt', 'kuiper'].map((k) => {
    const d = EXTRAS.find((x) => x.key === k);
    return `<button type="button" data-go="${k}"><i class="ti ti-${d.icon}"></i>${esc(tr(d.name).split(' — ')[0])}</button>`;
  }).join('');
  updateLabels();
  if (!card.hidden && focused) showBody(focused);
}

// ---------------- Döngü ----------------
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
let lastNow = 0;
function frame(now) {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - (lastNow || now)) / 1000);
  lastNow = now;
  for (const u of updaters) u(dt);
  // Hareket eden bir cisme (ISS, Parker, kuyruklu yıldız) odaklanılmışsa kamera onunla birlikte kayar.
  const fb = focused && bodies.get(focused);
  if (fb?.def.moving) {
    const p = centerOf(focused);
    if (fb.last) {
      const d = p.clone().sub(fb.last);
      camera.position.add(d);
      controls.target.add(d);
      if (tween) { tween.to.add(d); tween.tTo.add(d); }
    }
    fb.last = p;
  }
  if (tween) {
    const k = Math.min(1, (now - tween.start) / tween.ms), e = ease(k);
    camera.position.lerpVectors(tween.from, tween.to, e);
    controls.target.lerpVectors(tween.tFrom, tween.tTo, e);
    if (k >= 1) { const done = tween.done; tween = null; controls.enabled = true; done?.(); }
  }
  // Gök cisimleri yavaşça döner; odaklanılan cisim, işaretleri kolay seçilsin diye durur.
  for (const b of bodies.values()) if (b.def.key !== focused) b.mesh.rotation.y += b.def.key === 'sun' ? 0.0008 : 0.002;
  controls.update();
  // Bir gök cismine odaklanınca gece tarafındaki yerler de seçilebilsin diye ortam ışığı artar.
  ambient.intensity += ((focused ? 0.55 : 0.12) - ambient.intensity) * 0.08;
  // Bilgi kartı açıkken sahne kaydırılır (geniş ekranda sola, telefonda yukarı); gök cismi kartın altında kalmaz.
  const want = card.hidden ? 0 : innerWidth > 760 ? 185 : -Math.round(innerHeight * 0.22);
  if (want !== shift) {
    shift = want;
    setOffset();
  }
  // İşaretler sadece odaklanılan cismin kameraya bakan yüzündeyken görünür.
  for (const b of bodies.values()) {
    for (const m of b.marks) {
      if (b.def.key !== focused) { m.obj.visible = false; continue; }
      m.obj.getWorldPosition(tmp);
      b.group.getWorldPosition(tmp2);
      m.obj.visible = tmp.clone().sub(tmp2).dot(camera.position.clone().sub(tmp)) > 0;
    }
  }
  renderer.render(scene, camera);
  labels.render(scene, camera);
}

// ---------------- Dışarıya açık ----------------
// Haritadan gelince Dünya'nın yanından başlayıp Güneş Sistemi'ne doğru uzaklaşılır.
export function openSpace(opts = {}) {
  lang = opts.lang || lang;
  onExit = opts.onExit || null;
  if (!root) build();
  applyLang();
  root.hidden = false;
  requestAnimationFrame(() => root.classList.add('show'));
  open = true;
  focused = null;
  card.hidden = true; card.innerHTML = '';
  updateLabels();
  const e = centerOf('earth');
  camera.position.copy(e.clone().add(e.clone().negate().normalize().multiplyScalar(2.2)).add(new THREE.Vector3(0, 0.6, 0)));
  controls.target.copy(e);
  controls.minDistance = 8;
  controls.maxDistance = 420;
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
  flyTo(OVERVIEW.pos.clone(), OVERVIEW.target.clone(), 2600);
}

export function setSpaceLang(l) {
  lang = l;
  if (root) applyLang();
}

// Haritaya dönüş: önce Dünya'ya yaklaşılır, sonra uzay görünümü kapanır.
function exitToMap() {
  const e = centerOf('earth');
  focused = 'earth';
  card.hidden = true; card.innerHTML = '';
  updateLabels();
  controls.minDistance = 0.9;
  flyTo(e.clone().add(e.clone().negate().normalize().multiplyScalar(1.6)), e, 1300, () => {
    root.classList.remove('show');
    setTimeout(() => { root.hidden = true; cancelAnimationFrame(raf); open = false; }, 450);
    onExit?.();
  });
}

export const isSpaceOpen = () => open;
