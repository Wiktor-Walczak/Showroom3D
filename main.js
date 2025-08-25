// main.js (pełna, zaktualizowana wersja)
// Importy (ES module)
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';

// ====== THREE.JS SHOWROOM z realnym modelem + wczytywanie własnych plików ======
let scene, camera, renderer, controls;
let carRoot, carBBox, ground, dirLight;

let bodyParts = [];    // części „lakierowane”
let glassParts = [];   // szkło
let wheelGroups = [];  // grupy kół (4 grupy)
let originalMaterials = new Map();
let exploded = false;
let currentObjectURL = null;

// UI elements
const canvas = document.getElementById("webgl");
const panel = document.getElementById("panel");
const loading = document.getElementById("loading");
const loadingTextEl = loading?.querySelector('.loading-text') || null;

// ścieżki
const DEFAULT_LOCAL = "./Models/Car.glb";
const FALLBACK_DEMO = "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/Buggy/glTF-Binary/Buggy.glb";

const LOADING_TIMEOUT_MS = 12000;
let loadingTimeout = null;

init();
wireUI();
loadFromPath(DEFAULT_LOCAL);

// ---------- Init Three ----------
function init(){
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0b10);

  renderer = new THREE.WebGLRenderer({ canvas, antialias:true, preserveDrawingBuffer:true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
  camera.position.set(6.2, 2.6, 6.2);
  scene.add(camera);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = .08;
  controls.autoRotate = true;
  controls.autoRotateSpeed = .7;
  controls.minDistance = 3.5;
  controls.maxDistance = 18;
  controls.maxPolarAngle = Math.PI * 0.65;

  // Lights
  dirLight = new THREE.DirectionalLight(0xffffff, 2.4);
  dirLight.position.set(8, 10, 5);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  dirLight.shadow.camera.near = 1;
  dirLight.shadow.camera.far = 60;
  dirLight.shadow.camera.left = -15;
  dirLight.shadow.camera.right = 15;
  dirLight.shadow.camera.top = 15;
  dirLight.shadow.camera.bottom = -15;
  scene.add(dirLight);

  const fill = new THREE.HemisphereLight(0xffffff, 0x111111, 1.0);
  scene.add(fill);

  // Ground
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x0b0d13,
    roughness: 0.95,
    metalness: 0.0
  });
  ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), groundMat);
  ground.rotation.x = -Math.PI/2;
  ground.position.y = 0;
  ground.receiveShadow = true;
  scene.add(ground);

  // Debug helpers
  const debugAxes = new THREE.AxesHelper(5);
  debugAxes.name = "DEBUG_AXES";
  debugAxes.visible = false;
  scene.add(debugAxes);

  const debugGrid = new THREE.GridHelper(10, 10);
  debugGrid.name = "DEBUG_GRID";
  debugGrid.visible = false;
  scene.add(debugGrid);

  window.addEventListener('resize', resize);
  resize();
  animate();
}
function resize(){
  const parent = canvas.parentElement;
  const w = parent.clientWidth;
  const h = Math.max(parent.clientHeight, 540);
  renderer.setSize(w, h, false);
  camera.aspect = w/h;
  camera.updateProjectionMatrix();
}
function animate(){
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
  updateHotspots();
}

// ---------- Model loading ----------
function setLoading(on){
  loading.classList.toggle('hidden', !on);
  panel.classList.toggle('disabled', on);

  if (on){
    if (loadingTimeout) clearTimeout(loadingTimeout);
    loadingTimeout = setTimeout(()=>{
      console.warn("Loading timeout reached — hiding overlay to avoid permanent blocking.");
      loading.classList.add('hidden');
      panel.classList.remove('disabled');
      toast("Ładowanie modelu trwało za długo — sprawdź konsolę (F12).");
      if (loadingTextEl) loadingTextEl.textContent = "Wczytywanie modelu… (timeout)";
    }, LOADING_TIMEOUT_MS);
  } else {
    if (loadingTimeout) { clearTimeout(loadingTimeout); loadingTimeout = null; }
    if (loadingTextEl) loadingTextEl.textContent = "Wczytywanie modelu…";
  }
}
function disposeCurrent(){
  if (!carRoot) return;

  // Usuń poprzednie grupy kół (odłącz elementy poprawnie — spróbuj przywrócić ich world transform, ale tu upraszczamy: usuwamy grupy z sceny)
  wheelGroups.forEach(g=>{
    try{ scene.remove(g); }catch(e){}
  });
  wheelGroups = [];

  carRoot.traverse(o=>{
    if (o.isMesh){
      try{ o.geometry?.dispose?.(); }catch(e){}
      try{
        if (o.material){
          if (Array.isArray(o.material)) o.material.forEach(m=>m?.dispose?.());
          else o.material.dispose?.();
        }
      }catch(e){}
    }
  });
  try{ scene.remove(carRoot); }catch(e){}
  carRoot = null;
  originalMaterials.clear();
  bodyParts = [];
  glassParts = [];

  if (currentObjectURL){
    URL.revokeObjectURL(currentObjectURL);
    currentObjectURL = null;
  }
}

function loadFromPath(path){
  console.log("Rozpoczynam loadFromPath:", path);
  setLoading(true);
  disposeCurrent();

  const loader = new GLTFLoader();

  loader.load(
    path,
    gltf => onModelLoaded(gltf),
    xhr => {
      try{
        if (xhr && xhr.total){
          const pct = (xhr.loaded / xhr.total) * 100;
          if (loadingTextEl) loadingTextEl.textContent = `Wczytywanie modelu… (${Math.round(pct)}%)`;
          console.log(`Ładowanie modelu: ${Math.round(pct)}%`);
        } else {
          if (xhr && xhr.loaded) console.log(`Ładowano bajtów: ${xhr.loaded}`);
        }
      }catch(e){}
    },
    err => {
      console.warn("Nie udało się wczytać z path:", path, err);
      if (path !== FALLBACK_DEMO){
        toast("Nie znaleziono modelu w „"+path+"”. Ładuję model demo.");
        const demoLoader = new GLTFLoader();
        demoLoader.load(FALLBACK_DEMO,
          gltf => onModelLoaded(gltf),
          xhr => {
            if (xhr && xhr.total && loadingTextEl){
              loadingTextEl.textContent = `Wczytywanie modelu demo… (${Math.round((xhr.loaded/xhr.total)*100)}%)`;
            }
          },
          e=>{
            setLoading(false);
            toast("Błąd wczytywania modelu demo.");
            console.error("Błąd wczytywania modelu demo:", e);
          }
        );
      } else {
        setLoading(false);
      }
    }
  );
}

function loadFromFile(file){
  if (!file) { toast("Wybierz plik .glb lub .gltf"); return; }
  console.log("Wczytuję z pliku lokalnego:", file.name);
  setLoading(true);
  disposeCurrent();

  const url = URL.createObjectURL(file);
  currentObjectURL = url;

  const loader = new GLTFLoader();
  loader.load(
    url,
    gltf => onModelLoaded(gltf),
    xhr => {
      if (xhr && xhr.total && loadingTextEl){
        const pct = (xhr.loaded / xhr.total) * 100;
        loadingTextEl.textContent = `Wczytywanie pliku… (${Math.round(pct)}%)`;
      }
    },
    err => {
      setLoading(false);
      toast("Nie udało się wczytać wybranego pliku.");
      console.error("Błąd wczytywania z pliku:", err);
    }
  );
}

function onModelLoaded(gltf){
  console.log("✅ onModelLoaded wywołane", gltf);
  try{
    carRoot = gltf.scene || gltf.scenes?.[0];
    if (!carRoot) throw new Error("Brak gltf.scene");

    carRoot.visible = true;

    // zapamiętaj materiały i wymuś colorSpace na texturach
    carRoot.traverse(o=>{
      if (o.isMesh){
        o.castShadow = true;
        o.receiveShadow = true;
        originalMaterials.set(o, o.material);
        const m = o.material;
        if (m && m.map) m.map.colorSpace = THREE.SRGBColorSpace;
      }
    });

    // Wyśrodkuj i przeskaluj
    let bbox = new THREE.Box3().setFromObject(carRoot);
    // jeśli bbox jest pusty albo NaN, spróbuj rozszerzyć przez children
    if (!bbox.isEmpty() && Number.isFinite(bbox.min.x)){
      const size = bbox.getSize(new THREE.Vector3());
      const center = bbox.getCenter(new THREE.Vector3());

      const targetSize = 6.5;
      const maxDim = Math.max(size.x || 1, size.y || 1, size.z || 1);
      const scale = targetSize / maxDim;
      carRoot.scale.setScalar(scale);

      // Uaktualnij macierze i bbox po skalowaniu
      carRoot.updateMatrixWorld(true);
      bbox = new THREE.Box3().setFromObject(carRoot);
      const newCenter = bbox.getCenter(new THREE.Vector3());
      carRoot.position.sub(newCenter);
      carRoot.position.y = 0.7;

    } else {
      console.warn("BBox pusty lub niepoprawny — pomijam skalowanie/centrowanie.");
      carRoot.position.set(0, 0.7, 0);
      carRoot.scale.setScalar(1);
    }

    scene.add(carRoot);

    // Upewnij się, że wszystkie macierze world są aktualne przed klasyfikacją
    carRoot.updateMatrixWorld(true);

    carBBox = new THREE.Box3().setFromObject(carRoot);

    // Debug helpers sizing
    try{
      const axes = scene.getObjectByName("DEBUG_AXES");
      const grid = scene.getObjectByName("DEBUG_GRID");
      if (axes) {
        const s = Math.max( (carBBox.getSize(new THREE.Vector3()).length()), 2 );
        axes.scale.setScalar(s * 0.6);
        axes.visible = true;
      }
      if (grid) {
        const s = Math.max(carBBox.getSize(new THREE.Vector3()).length() * 1.2, 4);
        scene.remove(grid);
        const newGrid = new THREE.GridHelper(Math.ceil(s), Math.ceil(Math.min(s, 40)));
        newGrid.name = "DEBUG_GRID";
        scene.add(newGrid);
      }
      const boxHelper = new THREE.BoxHelper(carRoot, 0x7c83ff);
      boxHelper.name = "DEBUG_BOX_HELPER";
      scene.add(boxHelper);
      setTimeout(()=>{ const bh = scene.getObjectByName("DEBUG_BOX_HELPER"); if (bh) scene.remove(bh); }, 3000);
    }catch(e){ console.warn("Debug helpers error:", e); }

    // Klasyfikacja (zaktualizowana)
    classifyParts();

    // Zastosuj domyślny lakier
    applyDefaultPaint();

    // dopasuj kamerę
    fitCameraToBBox(carBBox);

    console.log("Model gotowy — bodyParts:", bodyParts.length, "glassParts:", glassParts.length, "wheelGroups:", wheelGroups.length);
  }catch(e){
    console.error("Błąd podczas przetwarzania modelu:", e);
    toast("Wystąpił błąd podczas przetwarzania modelu — sprawdź konsolę (F12).");
  } finally {
    setLoading(false);
    if (loadingTextEl) loadingTextEl.textContent = "Wczytywanie modelu…";
    updateHotspots();
  }
}

// ---------- Zmodernizowana heurystyka wyboru części ----------
function classifyParts(){
  bodyParts = [];
  glassParts = [];
  wheelGroups = [];

  const wheelKeywords = ['wheel','tire','tyre','rim','wheel_','wheel.', 'tyre_', 'tire_','wheelhub','hubcap'];
  const glassKeywords = ['glass','windshield','window','windscreen','wind_screen','windscreen','windshield', 'windscreen_main'];

  // ensure world matrices are up-to-date
  carRoot.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(carRoot);
  const center = bbox.getCenter(new THREE.Vector3());
  const size = bbox.getSize(new THREE.Vector3());

  const wheelCandidates = [];
  const visited = new Set();

  // 1) Najpierw sprawdź grupy (Group nodes), mogą zawierać meshe kół
  carRoot.traverse(node=>{
    if (!node) return;
    // jeśli node jest Group (nie Mesh) i zawiera jakieś meshe, użyj jego boudingBox/center jako kandydata
    if (!node.isMesh && node.type === 'Group'){
      let hasMesh = false;
      node.traverse(c=>{
        if (c.isMesh) hasMesh = true;
      });
      if (hasMesh){
        const box = new THREE.Box3().setFromObject(node);
        if (!box.isEmpty()){
          const p = box.getCenter(new THREE.Vector3());
          // heurystyka położenia: nisko i poza centrum
          const nearGround = p.y < (bbox.min.y + size.y*0.45);
          const horizontalDist = Math.sqrt(Math.pow(p.x-center.x,2) + Math.pow(p.z-center.z,2));
          const farEnough = horizontalDist > Math.max(size.x, size.z) * 0.20;
          if (nearGround && farEnough){
            wheelCandidates.push(node);
            visited.add(node);
          }
        }
      }
    }
  });

  // 2) Przeiteruj po meshach i zastosuj heurystyki nazwowe i pozycyjne
  carRoot.traverse(o=>{
    if (!o.isMesh) return;
    if (visited.has(o)) return;

    const name = (o.name || '').toLowerCase();
    const mat = o.material || {};
    const pos = o.getWorldPosition(new THREE.Vector3());

    // szkło: po nazwie lub przez przezroczystość/opacity
    if (glassKeywords.some(k => name.includes(k)) || (mat && (mat.transparent === true || (typeof mat.opacity === 'number' && mat.opacity < 0.98)))){
      glassParts.push(o);
      return;
    }

    // jeśli nazwa sugeruje koło -> kandydat
    if (wheelKeywords.some(k => name.includes(k))){
      wheelCandidates.push(o);
      visited.add(o);
      return;
    }

    // heurystyka pozycyjna: nisko + wystarczająco oddalone od środka (używamy odległości w płaszczyźnie XZ)
    const nearGround = pos.y < (bbox.min.y + size.y*0.40);
    const dx = Math.abs(pos.x - center.x);
    const dz = Math.abs(pos.z - center.z);
    const horizontalDist = Math.sqrt(dx*dx + dz*dz);
    const farEnough = horizontalDist > Math.max(size.x, size.z) * 0.20;
    if (nearGround && farEnough){
      wheelCandidates.push(o);
      visited.add(o);
      return;
    }
  });

  // 3) Grupuj kandidate według kwadrantów lub klastra
  wheelGroups = groupWheelsByQuadrant(wheelCandidates);

  // 4) „Lakierowane” = reszta mesh'y (bez szyb i kół)
  const inWheelsSet = new Set();
  wheelCandidates.forEach(m => inWheelsSet.add(m));

  carRoot.traverse(o=>{
    if (!o.isMesh) return;
    if (glassParts.includes(o) || inWheelsSet.has(o)) return;

    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.some(mm => mm && (mm.isMeshPhysicalMaterial || mm.isMeshStandardMaterial || mm.isMeshPhongMaterial || ('metalness' in mm) || ('roughness' in mm)))){
      bodyParts.push(o);
    }
  });

  // fallback: jeśli nie znaleziono bodyParts, weź wszystkie mesh'e poza szkłem
  if (bodyParts.length === 0){
    carRoot.traverse(o=>{ if (o.isMesh && !glassParts.includes(o)) bodyParts.push(o); });
  }

  // debug: wyświetl kandydatów kół w konsoli i chwilowo podświetl je (ułatwia debugging modeli)
  try{
    console.log('wheelCandidates (count):', wheelCandidates.length, wheelCandidates.map(m => ({ name: m.name || m.type, pos: (m.getWorldPosition(new THREE.Vector3())).toArray?.() })));
    // podświetlenie na krótko
    wheelCandidates.forEach(m=>{
      if (m.isMesh && m.material && m.material.emissive){
        // zachowaj referencję na stare emissive by przywrócić później (nie zrobimy restore tu, to tylko debug)
        m.material.emissive = m.material.emissive || new THREE.Color(0x000000);
        m.material.emissive.setHex(0xff4400);
        m.material.emissiveIntensity = 0.9;
      }
    });
    // przywrócenie po chwili (500ms)
    setTimeout(()=>{
      wheelCandidates.forEach(m=>{
        if (m.isMesh && m.material && m.material.emissive){
          try{ m.material.emissive.setHex(0x000000); }catch(e){}
        }
      });
    }, 500);
  }catch(e){}
}

function groupWheelsByQuadrant(meshes){
  const groups = [];
  const map = new Map();

  // funkcja pomocnicza do klucza (pozycja względem środka)
  const keyOf = (p)=> `${p.x >= 0 ? 'R':'L'}-${p.z >= 0 ? 'F':'B'}`;

  // dla każdego elementu oblicz world position (lub centroid jeśli node jest Group zawierający meshe)
  meshes.forEach(m=>{
    const p = new THREE.Vector3();
    if (m.isMesh){
      m.getWorldPosition(p);
    } else {
      // non-mesh node (Group) — użyj bounding box center
      const b = new THREE.Box3().setFromObject(m);
      if (!b.isEmpty()){
        b.getCenter(p);
      } else {
        m.getWorldPosition(p);
      }
    }
    const key = keyOf(p);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ node: m, pos: p });
  });

  // stwórz grupy dla każdego klucza; ustaw pozycję grupy jako centroid elementów
  for (const [key, arr] of map.entries()){
    const g = new THREE.Group();
    scene.add(g);

    // centroid:
    const centroid = arr.reduce((acc, entry) => acc.add(entry.pos), new THREE.Vector3()).multiplyScalar(1/arr.length);
    g.position.copy(centroid);

    // attach zachowując transform (g.attach)
    arr.forEach(entry=>{
      try{
        // jeśli node to mesh, attach go; jeśli to Group, przenieś children meshes
        if (entry.node.isMesh){
          g.attach(entry.node);
        } else {
          // jeśli node jest Group — przetransponuj jego mesh children do grupy
          entry.node.traverse(child=>{
            if (child.isMesh){
              try{ g.attach(child); }catch(e){ try{ g.add(child); }catch(e){} }
            }
          });
        }
      }catch(e){
        try{ g.add(entry.node); }catch(e){}
      }
    });

    g.userData.originalPosition = g.position.clone();
    groups.push(g);
  }

  return groups;
}

// ---------- Paint / Materials ----------
function applyDefaultPaint(){
  const paint = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#ffffff"),
    metalness: 0.85,
    roughness: 0.25,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.0
  });

  bodyParts.forEach(m=>{
    try{ m.material = paint; }catch(e){}
  });
}

function fitCameraToBBox(b){
  if (!b) return;
  const size = b.getSize(new THREE.Vector3());
  const center = b.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * (Math.PI / 180);
  let camZ = Math.abs(maxDim / (2 * Math.tan(fov / 2)));
  camZ *= 1.35;
  camera.position.set(center.x + camZ*0.8, center.y + camZ*0.5, center.z + camZ);
  controls.target.set(center.x, center.y + size.y*0.1, center.z);
  controls.update();
}

// ---------- UI & Actions ----------
function wireUI(){
  document.querySelectorAll('.swatch').forEach(btn=>{
    const col = btn.dataset.color;
    btn.style.background = col;
    btn.addEventListener('click', ()=>{
      setBodyColor(col);
      document.querySelectorAll('.swatch').forEach(s=>s.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  const finishWrap = document.getElementById('finish');
  finishWrap.querySelectorAll('button').forEach(b=>{
    b.addEventListener('click', ()=>{
      finishWrap.querySelectorAll('button').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      setFinish(b.dataset.finish);
    });
  });

  document.getElementById('autorotate').addEventListener('change', e=>{
    controls.autoRotate = e.target.checked;
  });
  document.getElementById('shadow').addEventListener('change', e=>{
    const en = e.target.checked;
    if (carRoot){
      carRoot.traverse(o=>{ if(o.isMesh){ o.castShadow = en; o.receiveShadow = en; }});
    }
    ground.receiveShadow = en;
  });
  document.getElementById('wireframe').addEventListener('change', e=>{
    const en = e.target.checked;
    [...bodyParts, ...glassParts].forEach(m=> { try{ m.material.wireframe = en; }catch(e){} });
  });

  const showHotspotsEl = document.getElementById('show-hotspots');
  if (showHotspotsEl){
    showHotspotsEl.addEventListener('change', e=>{
      setHotspotsVisible(!!e.target.checked);
    });
    setHotspotsVisible(!!showHotspotsEl.checked);
  }

  document.getElementById('view-front').addEventListener('click', ()=> moveCameraTo('front'));
  document.getElementById('view-side').addEventListener('click', ()=> moveCameraTo('side'));
  document.getElementById('view-top').addEventListener('click',  ()=> moveCameraTo('top'));

  document.getElementById('explode').addEventListener('click', toggleExplode);
  document.getElementById('screenshot').addEventListener('click', makeScreenshot);
  document.getElementById('reset').addEventListener('click', resetConfig);

  document.getElementById('save-conf').addEventListener('click', saveConfig);
  document.getElementById('load-conf').addEventListener('click', restoreConfig);

  document.getElementById('load-from-path').addEventListener('click', ()=>{
    const path = document.getElementById('model-path').value.trim();
    if (path) loadFromPath(path);
  });
  document.getElementById('load-from-file').addEventListener('click', ()=>{
    const f = document.getElementById('model-file').files?.[0];
    loadFromFile(f);
  });

  document.querySelector('.contact-form')?.addEventListener('submit', e=>{
    e.preventDefault(); toast('Dzięki! Odezwiemy się wkrótce.');
  });

  document.querySelector('.swatch[data-color="#ffffff"]')?.classList.add('active');
  document.querySelector('#finish button[data-finish="gloss"]')?.classList.add('active');
}

function setHotspotsVisible(visible){
  document.querySelectorAll('.hotspot').forEach(h=>{ h.style.display = visible ? '' : 'none'; });
}

function setBodyColor(hex){
  bodyParts.forEach(m=>{
    try{
      if (m.material && (m.material.isMeshPhysicalMaterial || m.material.isMeshStandardMaterial || m.material.isMeshPhongMaterial)){
        if (!m.material.isMeshPhysicalMaterial){
          const phys = new THREE.MeshPhysicalMaterial().copy(m.material);
          m.material = phys;
        }
        m.material.color.set(hex);
      }
    }catch(e){}
  });
  flashOutline();
}

function setFinish(type){
  bodyParts.forEach(m=>{
    const mat = m.material;
    if (!mat || !mat.isMeshPhysicalMaterial) return;
    if (type === 'gloss'){
      mat.metalness = 0.85; mat.roughness = 0.25; mat.clearcoat = 1.0; mat.clearcoatRoughness = 0.06;
    } else if (type === 'satin'){
      mat.metalness = 0.6;  mat.roughness = 0.45; mat.clearcoat = 0.6; mat.clearcoatRoughness = 0.25;
    } else {
      mat.metalness = 0.2;  mat.roughness = 0.8;  mat.clearcoat = 0.0; mat.clearcoatRoughness = 0.0;
    }
    mat.needsUpdate = true;
  });
}

function moveCameraTo(view){
  if (!carBBox) return;
  const size = carBBox.getSize(new THREE.Vector3());
  const center = carBBox.getCenter(new THREE.Vector3());

  let targetPos;
  if (view === 'front'){
    targetPos = new THREE.Vector3(center.x + size.x*0.9, center.y + size.y*0.45, center.z + size.z*0.05);
  } else if (view === 'side'){
    targetPos = new THREE.Vector3(center.x + size.x*0.05, center.y + size.y*0.4, center.z + size.z*1.1);
  } else { // top
    targetPos = new THREE.Vector3(center.x + size.x*0.05, center.y + size.y*1.6, center.z + size.z*0.1);
  }
  tweenCam(targetPos);
}
function tweenCam(target){
  const start = camera.position.clone();
  const end = target.clone();
  const duration = 650;
  const t0 = performance.now();
  controls.autoRotate = false;
  function step(){
    const t = Math.min(1, (performance.now()-t0)/duration);
    const k = t<.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2;
    camera.position.lerpVectors(start, end, k);
    controls.target.set(0,1,0);
    camera.lookAt(controls.target);
    if (t<1) requestAnimationFrame(step);
  }
  step();
}

// ---------- Zaktualizowany Explode / Implode ----------
function toggleExplode(){
  if (!wheelGroups || wheelGroups.length === 0){ toast('Nie wykryto kół w modelu'); return; }
  exploded = !exploded;
  const distFactor = exploded ? 1.0 : 0.0;

  // upewnij się, że bbox i macierze są zaktualizowane
  if (carRoot) carRoot.updateMatrixWorld(true);
  if (carBBox) carBBox = new THREE.Box3().setFromObject(carRoot);
  const center = carBBox ? carBBox.getCenter(new THREE.Vector3()) : new THREE.Vector3();
  const baseSize = carBBox ? carBBox.getSize(new THREE.Vector3()).length() : 1;
  const sizeScalar = baseSize * 0.18;

  wheelGroups.forEach((group, i)=>{
    group.updateMatrixWorld(true);
    const worldPos = new THREE.Vector3();
    group.getWorldPosition(worldPos);

    // kierunek = (groupPos - center) w XZ
    const dir = worldPos.clone().sub(center).setY(0);
    if (dir.lengthSq() < 1e-6) {
      dir.set(Math.sign(worldPos.x) || 1, 0, Math.sign(worldPos.z) || 1);
    }
    dir.normalize();

    const original = (group.userData && group.userData.originalPosition) ? group.userData.originalPosition.clone() : group.position.clone();
    const dist = sizeScalar * distFactor;
    const end = original.clone().addScaledVector(dir, dist);
    smoothMove(group, end, 600 + i*30);
  });
}

function smoothMove(obj, target, dur=600){
  const start = obj.position.clone();
  const t0 = performance.now();
  function step(){
    const t = Math.min(1, (performance.now()-t0)/dur);
    const k = t<.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2;
    obj.position.lerpVectors(start, target, k);
    if (t<1) requestAnimationFrame(step);
  }
  step();
}

// Screenshot
function makeScreenshot(){
  const url = renderer.domElement.toDataURL("image/png");
  const a = document.createElement('a');
  a.href = url;
  a.download = 'showroom3d.png';
  a.click();
}

// Reset
function resetConfig(){
  setBodyColor('#ffffff');
  document.querySelectorAll('.swatch').forEach(s=>s.classList.remove('active'));
  document.querySelector('.swatch[data-color="#ffffff"]')?.classList.add('active');

  document.querySelectorAll('#finish button').forEach(x=>x.classList.remove('active'));
  document.querySelector('#finish button[data-finish="gloss"]')?.classList.add('active');
  setFinish('gloss');

  controls.autoRotate = true;
  document.getElementById('autorotate').checked = true;

  document.getElementById('wireframe').checked = false;
  [...bodyParts, ...glassParts].forEach(m=> { try{ m.material.wireframe = false; }catch(e){} });

  if (wheelGroups && wheelGroups.length){
    wheelGroups.forEach((g, i)=>{
      const original = (g.userData && g.userData.originalPosition) ? g.userData.originalPosition.clone() : new THREE.Vector3();
      smoothMove(g, original, 500 + i*30);
    });
  }
  exploded = false;

  if (carBBox) fitCameraToBBox(carBBox);
}

// Persist (localStorage)
function saveConfig(){
  const firstBody = bodyParts[0]?.material;
  const conf = {
    color: firstBody ? '#'+firstBody.color.getHexString() : '#ffffff',
    finish: inferFinishFromMat(firstBody),
    autorotate: controls.autoRotate
  };
  localStorage.setItem('showroom3d-conf', JSON.stringify(conf));
  toast('Konfiguracja zapisana ✔');
}
function restoreConfig(){
  const raw = localStorage.getItem('showroom3d-conf');
  if(!raw) return;
  try{
    const c = JSON.parse(raw);
    setBodyColor(c.color || '#ffffff');
    setFinish(c.finish || 'gloss');
    controls.autoRotate = !!c.autorotate;
    document.getElementById('autorotate').checked = controls.autoRotate;
    document.querySelectorAll('.swatch').forEach(s=> s.classList.toggle('active', s.dataset.color.toLowerCase() === (c.color||'').toLowerCase()));
    document.querySelectorAll('#finish button').forEach(x=> x.classList.toggle('active', x.dataset.finish===(c.finish||'gloss')));
  }catch(e){}
}
function inferFinishFromMat(m){
  if (!m) return 'gloss';
  if(m.clearcoat>0.8 && m.roughness<0.35) return 'gloss';
  if(m.clearcoat>0.3 && m.roughness<0.6)  return 'satin';
  return 'matte';
}

// Hotspoty
function updateHotspots(){
  if (!carBBox) return;
  const center = carBBox.getCenter(new THREE.Vector3());
  const size = carBBox.getSize(new THREE.Vector3());

  const bodyPoint = new THREE.Vector3(center.x + size.x*0.2, center.y + size.y*0.8, center.z);
  positionHotspot(bodyPoint, document.getElementById('hs-body'));
  const wheelPoint = new THREE.Vector3(carBBox.max.x, carBBox.min.y + size.y*0.4, carBBox.max.z);
  positionHotspot(wheelPoint, document.getElementById('hs-wheel'));
}
function positionHotspot(vec3, el){
  if(!el) return;
  const v = vec3.clone();
  v.project(camera);
  const x = (v.x *  0.5 + 0.5) * canvas.clientWidth;
  const y = ( -v.y * 0.5 + 0.5) * canvas.clientHeight;
  el.style.left = `${x}px`;
  el.style.top  = `${y}px`;
}

// UX helpers
function toast(msg){
  const t = document.createElement('div');
  t.textContent = msg;
  Object.assign(t.style,{
    position:'fixed', bottom:'18px', left:'50%', transform:'translateX(-50%)',
    background:'#101522', color:'#dbe5ff', border:'1px solid #223054',
    padding:'10px 14px', borderRadius:'10px', fontSize:'14px', zIndex:9999,
    boxShadow:'0 10px 30px rgba(0,0,0,.4)'
  });
  document.body.appendChild(t);
  setTimeout(()=>{ t.remove(); }, 1700);
}

// Flash outline
function flashOutline(){
  if (!bodyParts[0]) return;
  const m = bodyParts[0].material;
  if (!m) return;
  const oldEm = m.emissive ? m.emissive.clone() : new THREE.Color(0x000000);
  if(!m.emissive) m.emissive = new THREE.Color(0x000000);
  let t0 = performance.now();
  function step(){
    const t = Math.min(1, (performance.now()-t0)/350);
    const s = Math.sin(t * Math.PI);
    m.emissive.setRGB(0.1*s, 0.1*s, 0.1*s);
    if (t<1) requestAnimationFrame(step);
    else m.emissive.copy(oldEm);
  }
  step();
}
