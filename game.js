import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'; 
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// --- POST-PROCESSING IMPORTS ---
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// --- PHYSICS ACCELERATION ---
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

// --- WIDE LINE (nav route) ---
import { Line2 }        from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

// Silently upgrade Three.js with BVH acceleration
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;
// --- iOS DETECTION + ADAPTIVE QUALITY ---
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const targetPixelRatio = () => isIOS
    ? Math.min(window.devicePixelRatio, 1.25)
    : Math.min(window.devicePixelRatio, 2);

// --- LOADING SCREEN SETUP ---
const loadingScreen = document.createElement('div');
loadingScreen.id = 'loading-screen';
loadingScreen.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: #000; color: #afe6ff; display: none; 
    justify-content: center; align-items: center; 
    font-family: 'HelveticaBold', sans-serif;
    font-size: 30px; font-weight: bold; z-index: 9999;
    flex-direction: column;
`;
// Change this line:
// loadingScreen.innerHTML = `<div>LOADING MAP...</div><div style="font-size:14px; margin-top:10px; opacity:0.7;">PLEASE WAIT</div>`;

// To this:
loadingScreen.innerHTML = `
    <img src="logonobg.png" alt="Mdrn Quest Logo" style="width: 300px; max-width: 80%; margin-bottom: 30px;">
    <div>LOADING MAP...</div>
    <div style="font-size:14px; margin-top:10px; opacity:0.7;">PLEASE WAIT</div>
`;
document.body.appendChild(loadingScreen);

// --- MAP SELECTION SCREEN SETUP ---
const mapSelectScreen = document.createElement('div');
mapSelectScreen.id = 'map-select-screen';
mapSelectScreen.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: linear-gradient(rgba(0, 0, 0, 0.75), rgba(0, 0, 0, 0.5)), url('menubg.jpg') center/cover no-repeat;
    display: flex; justify-content: center; align-items: center; flex-direction: column;
    z-index: 9998; font-family: 'Helvetica', Arial, sans-serif; color: white;
`;

mapSelectScreen.innerHTML = `
    <img src="mdrnquestlogo.png" alt="Mdrn Quest Logo" style="width: 85vw; max-width: 400px; margin-bottom: 10px;">
    
    <h1 style="font-family: 'Medieval', serif; color: #ffffff; font-size: 35px; text-align: center; margin-bottom: 25px; text-shadow: 2px 2px 5px #000; padding: 0 20px;">SELECT YOUR ZONE</h1>
    
    <p1 style="font-family: 'Helvetica', Arial, sans-serif; color: #cccccc; font-size: 16px; text-align: center; margin-bottom: 30px; max-width: 400px; padding: 0 20px;">Choose your starting zone and deliver your packages. All maps are built from real Google Maps data.</p1>

    <div style="display: flex; gap: 15px; flex-wrap: wrap; justify-content: center; padding: 0 10px;">
        
        <div class="map-card" data-map="shoreditch.glb" style="cursor: pointer; text-align: center; background: #222; padding: 10px; border-radius: 8px; border: 2px solid #444; transition: 0.2s; width: 40vw; max-width: 200px;">
            <img src="shoreditch.jpg" alt="Shoreditch" style="width: 100%; height: 20vh; max-height: 130px; object-fit: cover; border-radius: 4px; margin-bottom: 10px;">
            <div style="font-size: 16px; font-weight: bold;">SHOREDITCH</div>
        </div>

        <div class="map-card" data-map="archway.glb" style="cursor: pointer; text-align: center; background: #222; padding: 10px; border-radius: 8px; border: 2px solid #444; transition: 0.2s; width: 40vw; max-width: 200px;">
            <img src="archway.jpg" alt="Archway" style="width: 100%; height: 20vh; max-height: 130px; object-fit: cover; border-radius: 4px; margin-bottom: 10px;">
            <div style="font-size: 16px; font-weight: bold;">ARCHWAY</div>
        </div>

        <div class="map-card" data-map="carnabyst.glb" style="cursor: pointer; text-align: center; background: #222; padding: 10px; border-radius: 8px; border: 2px solid #444; transition: 0.2s; width: 40vw; max-width: 200px;">
            <img src="carnabyst.jpg" alt="Carnaby St" style="width: 100%; height: 20vh; max-height: 130px; object-fit: cover; border-radius: 4px; margin-bottom: 10px;">
            <div style="font-size: 16px; font-weight: bold;">CARNABY ST</div>
        </div>

    </div>
`;

document.body.appendChild(mapSelectScreen);

// Add click & hover events to the cards
document.querySelectorAll('.map-card').forEach(card => {
    // Hover effects
    card.addEventListener('mouseenter', () => card.style.borderColor = '#ffffff');
    card.addEventListener('mouseleave', () => card.style.borderColor = '#444');
    
    // Click to start
    card.addEventListener('click', (e) => {
        currentMapName = e.currentTarget.getAttribute('data-map');
        mapSelectScreen.style.display = 'none'; // Hide menu
        
        // Reset timers and activate game
        timeLeft = START_TIME; 
        gameActive = true; 
        
        // Load the chosen map!
        loadLevel(currentMapName);
    });
});

// --- GAME LOOP ---
const keys = { w: false, a: false, s: false, d: false, space: false, k: false, punch: false, superJump: false };
let cameraAngle = 0;
const cameraRotationSpeed = 0.03;
const currentLookAt = new THREE.Vector3(0, 0, 0);

// Define your maps array near the top of the file (with other configs) or right here
const maps = ['shoreditch.glb', 'archway.glb', 'carnabyst.glb'];
let currentMapIndex = 0; // Make sure this variable exists in your state variables

let roamingNPCs = []; // civilian roamers
const NPC_WALK_SPEED = 4.0;
const MAX_ROAMING_NPCS = 8;

window.switchMap = () => {
    gameActive = false; // Pause the game in the background
    document.getElementById('map-select-screen').style.display = 'flex'; // Show menu
    if (document.activeElement) document.activeElement.blur();
};

window.resetGame = () => {
    console.log("Reseting Game State...");

    // 1. Reset Game State Variables
    score = 0;
    armor = 0;
    timeLeft = START_TIME;
    gameActive = true;
    isBusted = false;
    isPaused = false;
    hasBike = false;
    hasJumpBoost = false;
    spawnTimer = 0;

    // 2. Reset Player Model Visibility
    if (playerMesh) playerMesh.visible = true;
    if (playerBikeMesh) playerBikeMesh.visible = false;

    // 3. Clear Existing Enemies
    activeEnemies.forEach(e => {
        enemiesGroup.remove(e.groupRef);
    });
    activeEnemies = []; // Clear the array

    // 4. Clear Existing Powerups
    powerups.forEach(p => {
        scene.remove(p);
    });
    powerups = [];

    // 5. Reset Player Position
    // Try to find a safe spot, or default to center
    let startPos = getAnywhereSpawnPoint(new THREE.Vector3(0,0,0), 0, 500);
    if (startPos) {
        playerGroup.position.copy(startPos);
        playerGroup.position.y += 2.0;
    } else {
        playerGroup.position.set(0, 20, 0);
    }
    verticalVelocity = 0;
    
    // 6. Spawn Initial Items
    spawnBeacon();

    for (let i = 0; i < 8; i++) spawnPowerup();

    // 7. Hide UI
    const uiGameOver = document.getElementById('game-over');
    if (uiGameOver) uiGameOver.style.display = 'none';
};

// --- MOBILE CONTROLS SETUP ---
let joystickInput = { x: 0, y: 0 };
let joystickManager;

// Wrap the joystick logic in a reusable function
function initJoystick() {
    const zone = document.getElementById('zone_joystick');
    if (typeof nipplejs !== 'undefined' && zone) {
        
        // 1. Destroy the old joystick if we are resizing the window
        if (joystickManager) {
            joystickManager.destroy();
        }

        // 2. Measure the new, correctly scaled size of the CSS container
        const dynamicSize = zone.getBoundingClientRect().width;

        // 3. Rebuild the joystick with the fresh dimensions
        joystickManager = nipplejs.create({
            zone: zone,
            mode: 'static',
            position: { left: '50%', top: '50%' },
            color: 'transparent', 
            size: dynamicSize, 
            restOpacity: 1, 
            catchOpacity: 1
        });
        
        joystickManager.on('move', function (evt, data) {
            if (data.vector) {
                joystickInput.y = data.vector.y; 
                joystickInput.x = data.vector.x; 
            }
        });
        joystickManager.on('end', function (evt) {
            joystickInput.x = 0;
            joystickInput.y = 0;
        });
    }
}

// Call the function when the game first loads
setTimeout(() => {
    initJoystick();

    const btnPause = document.getElementById('btn-pause');
    if (btnPause) {
        btnPause.addEventListener('click', (e) => { 
            e.preventDefault(); 
            isPaused = !isPaused; 
        });
    }

    const btnMap = document.getElementById('btn-map');
    if (btnMap) {
        btnMap.addEventListener('click', (e) => { 
            e.preventDefault(); 
            isMapOpen = !isMapOpen; 
        });
    }

    // --- CUSTOM ACTION BUTTONS (Touch & Mouse) ---
    function bindActionButton(buttonId, mappedKey) {
        const btn = document.getElementById(buttonId);
        if (!btn) return;

        const pressBtn = (e) => {
            if (e.cancelable) e.preventDefault(); // Stop double-firing on some touch-laptops
            btn.style.opacity = '0'; 
            keys[mappedKey] = true;
            if (navigator.vibrate) navigator.vibrate(15); 
        };

        const releaseBtn = (e) => {
            if (e.cancelable) e.preventDefault();
            btn.style.opacity = '1'; 
            keys[mappedKey] = false;
            if (mappedKey === 'space') jumpLocked = false; 
        };

        // Mobile Listeners
        btn.addEventListener('touchstart', pressBtn, { passive: false });
        btn.addEventListener('touchend', releaseBtn, { passive: false });
        
        // Desktop Listeners
        btn.addEventListener('mousedown', pressBtn);
        btn.addEventListener('mouseup', releaseBtn);
        btn.addEventListener('mouseleave', releaseBtn); // Catch if mouse dragged off button
    }

    // --- CUSTOM MENU BUTTONS (Touch & Mouse) ---
    function bindMenuButton(buttonId, targetElementId) {
        const btn = document.getElementById(buttonId);
        if (!btn) return;

        const pressBtn = (e) => {
            if (e.cancelable) e.preventDefault(); 
            btn.style.opacity = '0'; 
            if (navigator.vibrate) navigator.vibrate(20); 
            document.getElementById(targetElementId).click(); 
        };

        const releaseBtn = (e) => {
            if (e.cancelable) e.preventDefault();
            btn.style.opacity = '1'; 
        };

        // Mobile Listeners
        btn.addEventListener('touchstart', pressBtn, { passive: false });
        btn.addEventListener('touchend', releaseBtn, { passive: false });
        
        // Desktop Listeners
        btn.addEventListener('mousedown', pressBtn);
        btn.addEventListener('mouseup', releaseBtn);
        btn.addEventListener('mouseleave', releaseBtn);
    }

    // Bind Select to Map, and Start to Pause
    bindMenuButton('btn-triangle', 'btn-map');
    bindMenuButton('btn-start', 'btn-pause');

    // Map your buttons to keyboard keys here!
    bindActionButton('btn-x', 'space'); // X = Jump
    bindActionButton('btn-circle', 'punch'); // Circle = Punch    
    bindActionButton('btn-square', 'superJump'); // Square = Super Jump   
    // Add logic for others later:
    // bindActionButton('btn-square', 'e'); 
    // bindActionButton('btn-circle', 'shift'); 
    // bindActionButton('btn-triangle', 'f');
}, 500);

// --- KILL MOBILE DOUBLE-TAP ZOOM ---
    document.addEventListener('dblclick', function(event) {
        event.preventDefault();
    }, { passive: false });
    
    // --- KILL PULL-TO-REFRESH & SWIPE NAVIGATION ---
    document.addEventListener('touchmove', function(event) {
        // This brutally overrides iOS Safari and completely disables 
        // pull-to-refresh, page bouncing, and pinch-zooming globally.
        event.preventDefault();
    }, { passive: false });

// --- 1. CONFIGURATION ---
const START_TIME = 180.0;
const TIME_BONUS = 30.0;    
const BASE_SPEED = 20.0; 
const BIKE_MULTIPLIER = 1.8; 
const SUPER_JUMP_FORCE = 150.0;

// PICKUP BUDGET
// Previously one spawned every 0.5s with no cap and no despawn — ~360 per round,
// each cloning a template up to 1.4M triangles. These three constants are what
// keep pickups bounded; tune the rate/max together if you want a busier map.
const POWERUP_SPAWN_RATE   = 1.2;   // seconds between spawn attempts
const MAX_POWERUPS         = 14;    // hard ceiling on live pickups
const POWERUP_SPAWN_RADIUS = 420;   // spawn ring around the player
const POWERUP_DESPAWN_DIST = 700;   // cull once the player has ridden past

// MAP & AI CONFIG
const MAP_LIMIT = 4000;            
const ENEMY_RUN_SPEED = 21.0;      
const ENEMY_WALK_SPEED = 8.0;      
const ENEMY_VISION_DIST = 60.0;    
const ENEMY_HEARING_DIST = 10.0;   
const ENEMY_FOV = 135;             
const ENEMY_CATCH_RADIUS = 3.5; 

// WANTED LEVEL CONFIG
const WANTED_LEVEL_1_SCORE = 3; 
const WANTED_LEVEL_2_SCORE = 5; 

// STATE
let score = 0;
let armor = 0;
let timeLeft = START_TIME;
let gameActive = false;
let isPaused = false; 
let isTimerRunning = true;
let hasBike = false; 
let hasJumpBoost = false;
let isMapOpen = false; 
let spawnTimer = 0; 
let isBusted = false;

// PHYSICS STATE
let verticalVelocity = 0;
let isGrounded = true;
let jumpLocked = false;
let wallJumpsRemaining = 1;
const GRAVITY = -60.0;      
const JUMP_FORCE = 30.0;    

// DATA STORE
let validRoadPositions = [];
let colliderMeshes = [];
let roadMeshes = []; // NEW: Stores DATA_ROADS
let powerups = [];
let groundMeshes = []; // Only flat/road geometry — used for ground snapping

// NAV GRID (road-following pathfinding)
const NAV_CELL = 20;        // world-units per grid cell
const NAV_HALF = 4000;      // map extends ±4000 (matches MAP_LIMIT)
const NAV_DIM = Math.ceil((NAV_HALF * 2) / NAV_CELL); // 400 cells per axis
let navGrid = null;         // Uint8Array[NAV_DIM*NAV_DIM], 1=road 0=blocked
let navHeightGrid = null;   // Float32Array[NAV_DIM*NAV_DIM], road surface Y per cell
let currentNavPath = [];    // THREE.Vector3[] waypoints along road
let currentNavIndex = 0;
let pathRetryTimer = 0;
let navLineGroundTimer = 0;
let navLineUpdateTimer = 0.12; // start at threshold so first frame draws immediately

// Templates
let bikeTemplate = null; 
let drinkTemplate = null;
let lionTeeTemplate = null;      
let lionTeeGreyTemplate = null;
let beltTemplate = null; 
let policeTemplate = null;       
let policeClips = null;         

// BIKE VARIABLES
let playerBikeMesh = null;
let bikeMixer = null;
let customerMixer = null;
let bikeActions = []; // Stores all bike animations

// ACTIVE ENEMIES LIST
let activeEnemies = [];          

// MAP STATE
let currentMapName = 'shoreditch.glb'; 

// UI HELPERS
function updateUI() {
    const uiScore = document.getElementById('score');
    const uiTimer = document.getElementById('timer');
    const uiPause = document.getElementById('pause-screen'); 
    const uiGameOver = document.getElementById('game-over');
    const uiDrink = document.getElementById('status-drink');
    const uiBike = document.getElementById('status-bike');
    const uiDrinkTimer = document.getElementById('drink-timer');
    
    const warningUI = document.getElementById('zone-warning');
    if (warningUI) warningUI.style.display = 'none';

    if(uiScore) {
        let status = "WALKING";
        if (hasBike && hasJumpBoost) status = "STACKING IT"; 
        else if (hasBike) status = "ON BIKE";
        else if (hasJumpBoost) status = "BOOST READY";
        
        let wantedStars = "";
        if (score >= WANTED_LEVEL_2_SCORE) wantedStars = "★★";
        else if (score >= WANTED_LEVEL_1_SCORE) wantedStars = "★";
        
        uiScore.innerText = `${score} | 🛡️ ${armor} ${wantedStars}`;
    }

    if(uiTimer) {
        uiTimer.innerText = timeLeft.toFixed(1);
        uiTimer.className = timeLeft < 10 ? "danger" : "highlight";
    }
    
    if (uiDrink && uiBike) {
        if (hasBike) uiBike.style.display = 'block';
        else uiBike.style.display = 'none';

        if (hasJumpBoost) {
            uiDrink.style.display = 'block';
            uiDrinkTimer.innerText = 'READY ■';
        } else {
            uiDrink.style.display = 'none';
        }
    }
    
    if(uiPause) uiPause.style.display = isPaused ? "flex" : "none";
    
    // --- REPLACE WITH THIS ---
    if (uiGameOver) {
        if (!gameActive) {
            uiGameOver.style.display = "flex"; // Use Flex to stack text and button
            uiGameOver.style.flexDirection = "column";
            uiGameOver.style.alignItems = "center";
            uiGameOver.style.justifyContent = "center";
            uiGameOver.style.gap = "20px";

            // We use innerHTML so we can add the button
            // We add a check so we don't redraw the button 60 times a second (flickering)
            const titleText = isBusted ? "BUSTED" : "SHIFT ENDED";
            const color = isBusted ? "#0088ff" : "#ff3333";
            
            // Only update HTML if it's different to prevent resetting the button state
            if (!uiGameOver.getAttribute('data-shown')) {
                uiGameOver.innerHTML = `
                    <div style="font-family: 'Medieval', serif; font-size: 80px; color: ${color}; text-shadow: 2px 2px 5px #000; text-align: center;">${titleText}</div>
                    <div style="font-family: 'HelveticaBold', sans-serif; font-size: 24px; color: #fff; font-weight: bold;">SCORE: ${score}</div>
                    <button id="retry-btn" style="
                        margin-top: 10px;
                        padding: 15px 40px; 
                        font-size: 20px; 
                        font-family: 'HelveticaBold', sans-serif; 
                        font-weight: bold; 
                        background: #fff; 
                        color: #000; 
                        border: none; 
                        cursor: pointer;
                        pointer-events: auto;
                        border-radius: 5px;
                    ">TRY AGAIN</button>
                `;
                
                // Attach listener immediately
                document.getElementById('retry-btn').addEventListener('click', (e) => {
                    e.stopPropagation(); // Stop click from hitting game canvas
                    window.resetGame();
                    uiGameOver.setAttribute('data-shown', ''); // Reset flag
                });
                
                // Add touch listener for mobile to be instant
                document.getElementById('retry-btn').addEventListener('touchstart', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.resetGame();
                    uiGameOver.setAttribute('data-shown', '');
                });

                uiGameOver.setAttribute('data-shown', 'true');
            }
        } else {
            uiGameOver.style.display = "none";
            uiGameOver.removeAttribute('data-shown'); // Reset flag so it redraws next death
        }
    }
}

// --- 2. SCENE ---
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 3000);
camera.position.set(0, 20, 20); 

const renderer = new THREE.WebGLRenderer({ antialias: !isIOS, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(targetPixelRatio());
// Shadows cost a second pass over all 1.8M city triangles / 800+ draw calls.
// At a 512px map spanning 600 world units a character is ~3px wide, so on iOS
// we were paying full price for something effectively invisible.
renderer.shadowMap.enabled = !isIOS;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.useLegacyLights = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

// Surviving a GPU reset beats a blank canvas. iOS usually kills the tab outright
// rather than firing this, but it's a free safety net.
renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    console.warn('WebGL context lost — GPU memory pressure.');
    if (window.mqLog) window.mqLog('WEBGL_CONTEXT_LOST_GAME', rendererStats());
}, false);

// --- TEXTURE MEMORY GOVERNOR ---
// The raw assets decode to >1GB of GPU texture memory (shoreditch.glb alone is
// 573MB across 813 textures, customer.glb is 255MB in three 4096px PNGs).
// iOS Safari kills the tab somewhere north of ~300-400MB, so every texture is
// downsampled on the CPU before it is ever uploaded.
//
// The city is death by a thousand tiles, not a few big textures: shoreditch has
// 813 images averaging ~512px, which is ~590MB however you cap the outliers. The
// only lever that moves that number is capping ALL of them, hence the low world
// cap on iOS. Measured totals for a full shoreditch session:
//     uncapped              1.09 GB   (tab is killed)
//     world 512 / char 1024   755 MB  (fine on desktop, still fatal on iOS)
//     world 128 / char 512     ~95 MB (iOS target)
// Raise TEX_CAP_WORLD if you want sharper facades and can afford the memory.
// The better fix is tools/optimize-assets.mjs, which bakes the resize into the
// .glb — that cuts download size and decode time too, not just GPU memory, and
// lets this runtime cap be relaxed.
const TEX_CAP_WORLD = isIOS ? 128 : 512;   // city tiles — hundreds of them
const TEX_CAP_CHAR  = isIOS ? 512 : 1024;  // characters, pickups, props

// Keyed on the source image so textures sharing a bitmap are only resized once.
const resizedImageCache = new WeakMap();

function downscaleImage(img, cap) {
    const w = img.width, h = img.height;
    if (!w || !h || Math.max(w, h) <= cap) return null;
    if (resizedImageCache.has(img)) return resizedImageCache.get(img);

    const scale = cap / Math.max(w, h);
    const canvas = document.createElement('canvas');
    canvas.width  = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    resizedImageCache.set(img, canvas);
    // Release the full-size decode immediately rather than waiting on GC.
    if (typeof img.close === 'function') img.close();
    return canvas;
}

function optimizeMaterial(mat, cap) {
    for (const key in mat) {
        const value = mat[key];
        if (!value || !value.isTexture || !value.image) continue;
        const smaller = downscaleImage(value.image, cap);
        if (smaller) {
            value.image = smaller;
            value.needsUpdate = true;
        }
        value.anisotropy = isIOS ? 1 : 4;
    }
}

// Applied to every GLB the moment it lands, before its first render.
function optimizeModel(root, { cap = TEX_CAP_CHAR, castShadow = true, receiveShadow = true } = {}) {
    const seenMaterials = new Set();
    root.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow    = castShadow    && renderer.shadowMap.enabled;
        o.receiveShadow = receiveShadow && renderer.shadowMap.enabled;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
            if (!m || seenMaterials.has(m)) continue;
            seenMaterials.add(m);
            optimizeMaterial(m, cap);
        }
    });
    return root;
}

function rendererStats() {
    const i = renderer.info;
    return {
        geometries: i.memory.geometries,
        textures: i.memory.textures,
        programs: i.programs ? i.programs.length : 0,
        calls: i.render.calls,
        tris: i.render.triangles,
        powerups: powerups.length,
        enemies: activeEnemies.length,
        pixelRatio: +renderer.getPixelRatio().toFixed(2)
    };
}
window.mqStats = rendererStats;

// Measured GPU texture footprint of everything currently in the scene.
// renderer.info only reports a texture *count*, which hides the problem —
// 813 tiny tiles and 3 4096px PNGs look similar by count and differ 100x in bytes.
function textureBytes() {
    const seen = new Set();
    let bytes = 0, count = 0, largest = 0;
    scene.traverse(o => {
        if (!o.isMesh && !o.isSprite) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
            if (!m) continue;
            for (const k in m) {
                const t = m[k];
                if (!t || !t.isTexture || !t.image || seen.has(t)) continue;
                seen.add(t);
                const w = t.image.width || 0, h = t.image.height || 0;
                bytes += w * h * 4 * 1.33; // RGBA8 + mip chain
                largest = Math.max(largest, w, h);
                count++;
            }
        }
    });
    return { megabytes: +(bytes / 1048576).toFixed(1), textures: count, largestPx: largest };
}
window.mqTextureBytes = textureBytes;

// --- POST-PROCESSING SETUP (BOKEH) — skipped on iOS to save memory ---
let composer = null;
let bokehPass = null;
if (!isIOS) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    bokehPass = new BokehPass(scene, camera, {
        focus: 10.0,
        aperture: 0.00002,
        maxblur: 0.01,
        width: window.innerWidth,
        height: window.innerHeight
    });
    composer.addPass(bokehPass);
    composer.addPass(new OutputPass());
}

// --- DRACO LOADER SETUP (For your compressed Archway map) ---
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
// Note: We will attach this to the main loader below

// --- 3. LIGHTING ---
const hemiLight = new THREE.HemisphereLight(0x333366, 0x404040, 2.5);
scene.add(hemiLight);

const ambientLight = new THREE.AmbientLight(0xccccff, 1.5); 
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xaaccff, 1.2);
dirLight.position.set(50, 200, 50);
dirLight.castShadow = renderer.shadowMap.enabled;
dirLight.shadow.mapSize.width = isIOS ? 512 : 1024;
dirLight.shadow.mapSize.height = isIOS ? 512 : 1024;
dirLight.shadow.bias = -0.0005;
dirLight.shadow.camera.left = -300;
dirLight.shadow.camera.right = 300;
dirLight.shadow.camera.top = 300;
dirLight.shadow.camera.bottom = -300;
scene.add(dirLight);

// --- ENVIRONMENT ---
function initEnvironment() {
    const texLoader = new THREE.TextureLoader();
    texLoader.load('textures/sky.jpg', (texture) => {
        const pmremGenerator = new THREE.PMREMGenerator(renderer);
        const envMap = pmremGenerator.fromEquirectangular(texture).texture;
        scene.background = envMap; 
        texture.dispose();
        pmremGenerator.dispose();
    });

    const fogColor = 0x111122; 
    scene.fog = new THREE.Fog(fogColor, 1500, 3000); 

    const floorGeo = new THREE.CircleGeometry(4000, 32);
    const floorMat = new THREE.MeshStandardMaterial({ 
        color: 0x050505, 
        roughness: 0.9, 
        metalness: 0.1 
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.5; 
    floor.receiveShadow = true;
    floor.visible = false; 
    scene.add(floor);
}

initEnvironment(); 

// --- 4. ASSETS ---
const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader); // <--- Add this line

const cityGroup = new THREE.Group();
scene.add(cityGroup);

const playerGroup = new THREE.Group();
scene.add(playerGroup);

const enemiesGroup = new THREE.Group();
scene.add(enemiesGroup);

const playerFillLight = new THREE.PointLight(0xffffff, 1.5, 10);
playerFillLight.position.set(0, 2, 2); 
playerGroup.add(playerFillLight);

const beaconGroup = new THREE.Group();
scene.add(beaconGroup);

// BEACON
const beaconMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(2, 2, 80, 16), 
    new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.5 })
);
beaconMesh.position.y = 40; 
beaconGroup.add(beaconMesh);

const beaconLight = new THREE.PointLight(0x00ff00, 800, 100);
beaconLight.position.y = 10;
beaconGroup.add(beaconLight);

//ADDING CUSTOMER MODEL
loader.load('customer.glb', (gltf) => {
    // Ships with three 4096px PNGs — 255MB of GPU memory for one NPC.
    const customerMesh = optimizeModel(gltf.scene, { cap: TEX_CAP_CHAR });
    customerMesh.scale.set(4.0, 4.0, 4.0); // Adjust size if needed

    beaconGroup.add(customerMesh);

    // Setup animations using 'Pacing'
    customerMixer = new THREE.AnimationMixer(customerMesh);
    if (gltf.animations.length > 0) {
        const clip = THREE.AnimationClip.findByName(gltf.animations, 'Pacing') || gltf.animations[0];
        if (clip) {
            const action = customerMixer.clipAction(clip);
            action.play();
        }
    }
}, undefined, (err) => console.error("Customer Model Error:", err));

// ARROW
const arrowMesh = new THREE.Mesh(
    new THREE.ConeGeometry(0.5, 1.5, 8),
    new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.8 }) 
);
arrowMesh.geometry.rotateX(Math.PI / 2);
arrowMesh.position.y = 6;
playerGroup.add(arrowMesh);

// Yellow dashed route line — Line2 so linewidth actually works in WebGL
const navLineMat = new LineMaterial({
    color: 0xffff00,
    linewidth: 5,
    dashed: true,
    dashSize: 10,
    gapSize: 6,
    dashScale: 1,
    resolution: new THREE.Vector2(window.innerWidth, window.innerHeight)
});
const navLineGeo = new LineGeometry();
const navLine = new Line2(navLineGeo, navLineMat);
navLine.frustumCulled = false;
navLine.visible = false;
scene.add(navLine);

// --- MAP LOADER FUNCTION ---
function loadLevel(mapName) {
    console.log("Loading Map:", mapName);
    document.getElementById('loading-screen').style.display = 'flex';
    
    // Dispose old map's GPU resources before removing — iOS will crash without this
    cityGroup.traverse(o => {
        if (o.isMesh) {
            if (o.geometry) {
                if (o.geometry.disposeBoundsTree) o.geometry.disposeBoundsTree();
                o.geometry.dispose();
            }
            if (o.material) {
                const mats = Array.isArray(o.material) ? o.material : [o.material];
                mats.forEach(m => {
                    for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose();
                    m.dispose();
                });
            }
        }
    });
    while (cityGroup.children.length > 0) cityGroup.remove(cityGroup.children[0]);
    renderer.renderLists.dispose();
    colliderMeshes = [];
    roadMeshes = [];
    groundMeshes = [];
    validRoadPositions = [];
    navGrid = null;
    navHeightGrid = null;
    currentNavPath = [];
    currentNavIndex = 0;
    pathRetryTimer = 0;
    powerups.forEach(p => scene.remove(p));
    powerups = [];
    activeEnemies.forEach(e => { enemiesGroup.remove(e.groupRef); });
    activeEnemies = [];

    roamingNPCs.forEach(n => scene.remove(n.mesh));
    roamingNPCs = [];

    loader.load(mapName, (gltf) => {
        const map = gltf.scene;
        map.scale.set(3.5, 3.5, 3.5);
        
        const box = new THREE.Box3().setFromObject(map);
        const center = box.getCenter(new THREE.Vector3());
        map.position.x += (map.position.x - center.x);
        map.position.z += (map.position.z - center.z);
        map.position.y = -0.2; 

        map.traverse((child) => {
            if (child.isMesh) {
                // 1. DATA ROADS (New Logic)
                if (child.name.toUpperCase().includes("DATA_ROAD")) {
                    child.visible = false;
                    if (child.geometry) child.geometry.computeBoundsTree();
                    roadMeshes.push(child);
                }
                else if (child.name.includes("Border") || child.name.includes("border")) {
                    child.visible = false;
                    if (child.geometry) child.geometry.computeBoundsTree(); // ADD THIS
                    colliderMeshes.push(child);
                }
                else if (child.name !== "IGNORE_ME") {
                    child.castShadow = renderer.shadowMap.enabled;
                    child.receiveShadow = renderer.shadowMap.enabled;
                    child.name = "CITY_MESH";

                    // --- NEW: BUILD SEARCH INDEX FOR THIS SPECIFIC TILE ---
                    if (child.geometry) child.geometry.computeBoundsTree();

                    colliderMeshes.push(child); // Buildings / Ground
                    if (child.material) {
                        child.material.roughness = 0.9;
                        child.material.metalness = 0.1;
                        child.material.side = THREE.DoubleSide;
                        // Downsample this tile's texture before it reaches the GPU.
                        // Uncapped, these 500-800 tiles are 380-573MB on their own.
                        optimizeMaterial(child.material, TEX_CAP_WORLD);
                    }

                    // Inside the traverse, after: colliderMeshes.push(child)
                    // Add ground geometry (non-building, low Y faces) separately
                    
                }
            }
        });
        
        cityGroup.add(map);

        cityGroup.updateMatrixWorld(true);
        
        // Updated spawn call:
        let startPos = getAnywhereSpawnPoint(new THREE.Vector3(0,0,0), 0, 3000);
        
        if (startPos) {
            playerGroup.position.copy(startPos);
            playerGroup.position.y += 5.0; 
            verticalVelocity = 0; 
        } else {
            console.error("Could not find spawn point on ROAD, defaulting to 0,20,0");
            playerGroup.position.set(0, 20, 0); 
        }
        
        buildNavGrid();
        spawnBeacon();

        // Spawn initial roaming NPCs
        for (let i = 0; i < 5; i++) spawnRoamingNPC();

        // Seed the pickup budget; the rest trickle in around the player as they ride.
        for (let i = 0; i < 8; i++) spawnPowerup();

        document.getElementById('loading-screen').style.display = 'none';

        // Record what this map actually cost, so the iPhone crash badge has numbers.
        renderer.render(scene, camera); // flush uploads so info.memory is accurate
        const stats = rendererStats();
        console.log('Map loaded:', mapName, stats);
        if (window.mqLog) window.mqLog('MAP_LOADED', { map: mapName, ...stats });

    }, undefined, (err) => {
        console.error("Map Error:", err);
        alert("Could not load map: " + mapName);
        document.getElementById('loading-screen').style.display = 'none';
    });
}

//loadLevel(currentMapName);

// --- PLAYER LOADER ---
let playerMesh;
let mixer;
let animationsMap = new Map();
let currentAction;

loader.load('playermodel.glb', (gltf) => {
    playerMesh = optimizeModel(gltf.scene, { cap: TEX_CAP_CHAR });
    playerMesh.scale.set(2.0, 2.0, 2.0);
    playerMesh.rotation.y = Math.PI;

    playerMesh.traverse(o => {
        if (o.isMesh && o.material) {
            o.material.metalness = 0.0;
            o.material.roughness = 0.8;
            if (o.material.color) o.material.color.set(0xffffff);
        }
    });

    playerGroup.add(playerMesh);
    
    mixer = new THREE.AnimationMixer(playerMesh);
    const clips = gltf.animations;

    const idleClip = THREE.AnimationClip.findByName(clips, 'Idle');
    const runClip = THREE.AnimationClip.findByName(clips, 'Run');
    const jumpClip = THREE.AnimationClip.findByName(clips, 'Jump');

    if (idleClip) animationsMap.set('Idle', mixer.clipAction(idleClip));
    if (runClip) animationsMap.set('Run', mixer.clipAction(runClip));
    if (jumpClip) animationsMap.set('Jump', mixer.clipAction(jumpClip));
    
    currentAction = animationsMap.get('Idle');
    if (currentAction) currentAction.play();

}, undefined, (err) => console.error("Player Model Error:", err));

// --- PLAYER BIKE LOADER ---
loader.load('playerbike.glb', (gltf) => {
    playerBikeMesh = optimizeModel(gltf.scene, { cap: TEX_CAP_CHAR });
    playerBikeMesh.scale.set(2.0, 2.0, 2.0);
    playerBikeMesh.rotation.y = THREE.MathUtils.degToRad(180);
    playerBikeMesh.visible = false; // Hidden by default (until powerup collected)

    playerBikeMesh.traverse(o => {
        // Fix dark materials if necessary
        if (o.isMesh && o.material) {
            o.material.metalness = 0.0;
            o.material.roughness = 0.8;
            if (o.material.color) o.material.color.set(0xffffff);
        }
    });

    playerGroup.add(playerBikeMesh);
    
    // Setup Animations: Prepare ALL clips to play together
    bikeMixer = new THREE.AnimationMixer(playerBikeMesh);
    if (gltf.animations.length > 0) {
        gltf.animations.forEach((clip) => {
            const action = bikeMixer.clipAction(clip);
            bikeActions.push(action);
        });
    }

}, undefined, (err) => console.error("Player Bike Error:", err));

// --- ENEMY LOADER ---
loader.load('police.glb', (gltf) => {
    policeTemplate = optimizeModel(gltf.scene, { cap: TEX_CAP_CHAR });
    policeClips = gltf.animations;
    console.log("Police Template Loaded");
}, undefined, (err) => console.error("Police Model Error:", err));


// --- POWERUP ASSETS ---
// Pickups never cast shadows: the tee alone is 1.4M triangles, and paying for it
// twice in the shadow pass buys nothing at this shadow map resolution.
loader.load('limebike.glb', (gltf) => {
    bikeTemplate = optimizeModel(gltf.scene, { cap: TEX_CAP_CHAR, castShadow: false });
    bikeTemplate.scale.set(2.5, 2.5, 2.5);
    bikeTemplate.traverse(o => {
        if (o.isMesh && o.material) {
            o.material.color.set(0xffffff);
            o.material.metalness = 0.1;
            o.material.roughness = 0.5;
            o.material.emissive = new THREE.Color(0x222222);
        }
    });
});

loader.load('monster_zero_ultra.glb', (gltf) => {
    drinkTemplate = optimizeModel(gltf.scene, { cap: TEX_CAP_CHAR, castShadow: false });
    drinkTemplate.scale.set(0.6, 0.6, 0.6);
});

loader.load('liontee.glb', (gltf) => {
    lionTeeTemplate = optimizeModel(gltf.scene, { cap: TEX_CAP_CHAR, castShadow: false });
    lionTeeTemplate.scale.set(2.5, 2.5, 2.5);

    // lionteegrey.glb is a byte-for-byte duplicate of liontee.glb (identical MD5),
    // so we build the grey variant off the same geometry and textures instead of
    // paying for a second 39MB download and a second 59MB texture upload.
    lionTeeGreyTemplate = lionTeeTemplate.clone();
    lionTeeGreyTemplate.traverse(o => {
        if (!o.isMesh || !o.material) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const greyed = mats.map(m => {
            const c = m.clone();            // clone shares the texture objects
            if (c.color) c.color.set(0x8f8f8f);
            return c;
        });
        o.material = Array.isArray(o.material) ? greyed : greyed[0];
    });
});

loader.load('belt.glb', (gltf) => {
    beltTemplate = optimizeModel(gltf.scene, { cap: TEX_CAP_CHAR, castShadow: false });
    beltTemplate.scale.set(2.0, 2.0, 2.0);
});


// --- 5. LOGIC & SPAWNING ---
const raycaster = new THREE.Raycaster();
const downVector = new THREE.Vector3(0, -1, 0);

function calculateMovement(position, moveVec, speed, delta) {
    let finalMove = moveVec.clone().multiplyScalar(speed * delta);

    const PLAYER_RADIUS = 1.2;  // Wider than before — catches corners
    const PUSH_BACK = 0.05;     // Small push away from wall surface
    const heights = [0.3, 1.2, 2.2]; // Ankles, waist, shoulders

    // Fan angles: forward + 22.5 + 45 degrees either side
    const fanAngles = [0, Math.PI / 8, -Math.PI / 8, Math.PI / 4, -Math.PI / 4];

    // Side rays (perpendicular to movement, catches sliding edge cases)
    const sideVec = new THREE.Vector3(-moveVec.z, 0, moveVec.x).normalize();
    const sideOffsets = [-0.4, 0, 0.4];

    const wallNormals = [];

    for (let h of heights) {
        const origin = position.clone();
        origin.y += h;

        // --- Forward fan ---
        for (let angle of fanAngles) {
            const dir = moveVec.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angle).normalize();
            raycaster.set(origin, dir);
            const hits = raycaster.intersectObjects(colliderMeshes, false);
            if (hits.length > 0 && hits[0].distance < PLAYER_RADIUS) {
                const normal = hits[0].face.normal.clone();
                const nm = new THREE.Matrix3().getNormalMatrix(hits[0].object.matrixWorld);
                normal.applyMatrix3(nm).normalize();
                normal.y = 0; // Ignore vertical component — don't push up/down
                if (normal.lengthSq() > 0.01) wallNormals.push(normal);
            }
        }

        // --- Side rays (perpendicular) ---
        for (let sOff of sideOffsets) {
            const sOrigin = origin.clone().addScaledVector(sideVec, sOff);
            raycaster.set(sOrigin, moveVec);
            const hits = raycaster.intersectObjects(colliderMeshes, false);
            if (hits.length > 0 && hits[0].distance < PLAYER_RADIUS * 0.8) {
                const normal = hits[0].face.normal.clone();
                const nm = new THREE.Matrix3().getNormalMatrix(hits[0].object.matrixWorld);
                normal.applyMatrix3(nm).normalize();
                normal.y = 0;
                if (normal.lengthSq() > 0.01) wallNormals.push(normal);
            }
        }
    }

    // Apply all wall normals — each slides movement along that wall
    for (let normal of wallNormals) {
        const dot = finalMove.dot(normal);
        if (dot < 0) {
            finalMove.sub(normal.multiplyScalar(dot));
            // Tiny push-back so player doesn't embed in surface
            finalMove.addScaledVector(normal, PUSH_BACK);
        }
    }

    finalMove.y = 0; // Never let horizontal movement affect vertical
    return finalMove;
}

function getAnywhereSpawnPoint(centerPos, minRadius, maxRadius) {
    // If no road meshes found, fallback to old logic (collisions with floor)
    const useRoadLogic = roadMeshes.length > 0;
    // We search against everything (including hidden roads)
    const searchMeshes = useRoadLogic ? [...roadMeshes, ...colliderMeshes] : colliderMeshes;

    // Increased maxTries because finding a specific road is harder than just "any floor"
    const maxTries = 200; 
    
    for (let i = 0; i < maxTries; i++) {
        let radius = minRadius + Math.sqrt(Math.random()) * (maxRadius - minRadius);
        let angle = Math.random() * Math.PI * 2;
        let baseX = centerPos ? centerPos.x : 0;
        let baseZ = centerPos ? centerPos.z : 0;
        let testX = baseX + Math.cos(angle) * radius;
        let testZ = baseZ + Math.sin(angle) * radius;
        
        if (Math.abs(testX) > MAP_LIMIT || Math.abs(testZ) > MAP_LIMIT) continue;

        // Cast from high up
        raycaster.set(new THREE.Vector3(testX, 500, testZ), downVector);
        
        // Intersect against BOTH Roads and Buildings (sorted by distance)
        const intersects = raycaster.intersectObjects(searchMeshes, false);
        
        if (intersects.length > 0) {
            
            if (useRoadLogic) {
                // Check if the ray actually passed through a Road Mesh at some point
                const hitRoad = intersects.find(hit => roadMeshes.includes(hit.object));

                if (hitRoad) {
                    // We are aligned with a road mesh (even if it is deep underground).
                    
                    // Now check the *First* object we hit (the visible surface).
                    // Logic: If the first object we hit is "High" (a building roof), it's invalid.
                    // If the first object we hit is "Low" (near 0), it's the street surface.
                    
                    const topHit = intersects[0];
                    const surfaceY = topHit.point.y;

                    // Assuming street level is roughly between -5 and +8
                    // If we hit a roof at Y=20, this condition fails.
                    if (surfaceY > -10 && surfaceY < 10) {
                        return new THREE.Vector3(testX, surfaceY + 2.0, testZ);
                    }
                }
            } else {
                // Fallback (Old Logic): Just check height valid
                const firstHit = intersects[0];
                if (firstHit.point.y > -20 && firstHit.point.y < 50) {
                    return new THREE.Vector3(testX, firstHit.point.y + 2.0, testZ);
                }
            }
        } 
    }
    return null; 
}

function spawnBeacon() {
    // Retry until we land at true road level (Y < 6 after the +2 offset added by
    // getAnywhereSpawnPoint), ruling out rooftops and elevated areas.
    let pos = null;
    for (let attempt = 0; attempt < 40; attempt++) {
        const candidate = getAnywhereSpawnPoint(playerGroup.position, 400, 1500);
        if (candidate && candidate.y < 6) { pos = candidate; break; }
    }

    if (pos) {
        beaconGroup.position.copy(pos);
        beaconGroup.position.y -= 2.0;
    } else {
        beaconGroup.position.set(playerGroup.position.x + 100, 0, playerGroup.position.z);
    }

    currentNavPath = findRoadPath(playerGroup.position, beaconGroup.position) || [];
    currentNavIndex = 0;

    updateWantedSystem();
}

// --- ROAD-FOLLOWING NAVIGATION ---

function buildNavGrid() {
    // Prefer dedicated road meshes; fall back to ground-level colliders so
    // navigation works even on maps that lack DATA_ROAD geometry.
    const useRoadMeshes = roadMeshes.length > 0;
    const meshesToScan  = useRoadMeshes ? roadMeshes : colliderMeshes;
    if (meshesToScan.length === 0) return;

    // Tighter Y band when using colliders so building rooftops aren't treated as roads.
    const minY = useRoadMeshes ? -10 : -2;
    const maxY = useRoadMeshes ?  10 :  5;

    const grid    = new Uint8Array(NAV_DIM * NAV_DIM);
    const heights = new Float32Array(NAV_DIM * NAV_DIM);
    const down    = new THREE.Vector3(0, -1, 0);
    const rc      = new THREE.Raycaster();
    rc.firstHitOnly = true;

    for (let gz = 0; gz < NAV_DIM; gz++) {
        for (let gx = 0; gx < NAV_DIM; gx++) {
            const wx = -NAV_HALF + gx * NAV_CELL + NAV_CELL * 0.5;
            const wz = -NAV_HALF + gz * NAV_CELL + NAV_CELL * 0.5;
            rc.set(new THREE.Vector3(wx, 500, wz), down);
            const hits = rc.intersectObjects(meshesToScan, false);
            if (hits.length > 0 && hits[0].point.y > minY && hits[0].point.y < maxY) {
                grid[gz * NAV_DIM + gx] = 1;
                heights[gz * NAV_DIM + gx] = hits[0].point.y;
            }
        }
    }
    navGrid = grid;
    navHeightGrid = heights;
    const roadCells = grid.reduce((s, v) => s + v, 0);
    console.log(`Nav grid built: ${NAV_DIM}x${NAV_DIM}, road cells: ${roadCells} (source: ${useRoadMeshes ? 'DATA_ROAD meshes' : 'collider fallback'})`);
}

function worldToCell(wx, wz) {
    return {
        gx: Math.max(0, Math.min(NAV_DIM - 1, Math.floor((wx + NAV_HALF) / NAV_CELL))),
        gz: Math.max(0, Math.min(NAV_DIM - 1, Math.floor((wz + NAV_HALF) / NAV_CELL)))
    };
}

// Snap a non-road cell to the nearest road cell within `radius` cells
function nearestRoadCell(gx, gz, radius = 10) {
    if (navGrid[gz * NAV_DIM + gx] === 1) return { gx, gz };
    for (let r = 1; r <= radius; r++) {
        for (let dz = -r; dz <= r; dz++) {
            for (let dx = -r; dx <= r; dx++) {
                if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
                const nx = gx + dx, nz = gz + dz;
                if (nx < 0 || nx >= NAV_DIM || nz < 0 || nz >= NAV_DIM) continue;
                if (navGrid[nz * NAV_DIM + nx] === 1) return { gx: nx, gz: nz };
            }
        }
    }
    return null;
}

function findRoadPath(startPos, endPos) {
    if (!navGrid) return null;

    const s = worldToCell(startPos.x, startPos.z);
    const e = worldToCell(endPos.x, endPos.z);
    const startCell = nearestRoadCell(s.gx, s.gz) || s;
    const endCell   = nearestRoadCell(e.gx, e.gz) || e;

    if (startCell.gx === endCell.gx && startCell.gz === endCell.gz) return [];

    const idx = (gx, gz) => gz * NAV_DIM + gx;
    const heur = (gx, gz) => Math.abs(gx - endCell.gx) + Math.abs(gz - endCell.gz);

    const gScore   = new Float32Array(NAV_DIM * NAV_DIM).fill(Infinity);
    const cameFrom = new Int32Array(NAV_DIM * NAV_DIM).fill(-1);
    const inOpen   = new Uint8Array(NAV_DIM * NAV_DIM);

    gScore[idx(startCell.gx, startCell.gz)] = 0;

    // Min-heap keyed on f = g + h
    const heap = [];
    const heapPush = (item) => {
        heap.push(item);
        let i = heap.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (heap[p].f <= heap[i].f) break;
            [heap[p], heap[i]] = [heap[i], heap[p]];
            i = p;
        }
    };
    const heapPop = () => {
        const top = heap[0];
        const last = heap.pop();
        if (heap.length > 0) {
            heap[0] = last;
            let i = 0;
            while (true) {
                let m = i, l = 2*i+1, r = 2*i+2;
                if (l < heap.length && heap[l].f < heap[m].f) m = l;
                if (r < heap.length && heap[r].f < heap[m].f) m = r;
                if (m === i) break;
                [heap[m], heap[i]] = [heap[i], heap[m]];
                i = m;
            }
        }
        return top;
    };

    heapPush({ gx: startCell.gx, gz: startCell.gz, f: heur(startCell.gx, startCell.gz) });
    inOpen[idx(startCell.gx, startCell.gz)] = 1;

    const dirs = [[1,0,1],[-1,0,1],[0,1,1],[0,-1,1],[1,1,1.414],[1,-1,1.414],[-1,1,1.414],[-1,-1,1.414]];

    while (heap.length > 0) {
        const cur = heapPop();
        const curIdx = idx(cur.gx, cur.gz);

        if (cur.gx === endCell.gx && cur.gz === endCell.gz) {
            const path = [];
            let c = curIdx;
            const startIdx = idx(startCell.gx, startCell.gz);
            while (c !== startIdx && c !== -1) {
                const gx = c % NAV_DIM;
                const gz = Math.floor(c / NAV_DIM);
                const wy = navHeightGrid ? navHeightGrid[c] : 0;
                path.unshift(new THREE.Vector3(
                    -NAV_HALF + gx * NAV_CELL + NAV_CELL * 0.5,
                    wy,
                    -NAV_HALF + gz * NAV_CELL + NAV_CELL * 0.5
                ));
                c = cameFrom[c];
            }
            path.push(endPos.clone());
            return simplifyNavPath(path);
        }

        for (const [dx, dz, cost] of dirs) {
            const nx = cur.gx + dx, nz = cur.gz + dz;
            if (nx < 0 || nx >= NAV_DIM || nz < 0 || nz >= NAV_DIM) continue;
            if (navGrid[idx(nx, nz)] === 0) continue;

            const nIdx = idx(nx, nz);
            const tentG = gScore[curIdx] + cost;
            if (tentG < gScore[nIdx]) {
                gScore[nIdx] = tentG;
                cameFrom[nIdx] = curIdx;
                if (!inOpen[nIdx]) {
                    inOpen[nIdx] = 1;
                    heapPush({ gx: nx, gz: nz, f: tentG + heur(nx, nz) });
                }
            }
        }
    }

    return null;
}

function simplifyNavPath(path) {
    if (path.length <= 2) return path;
    const out = [path[0]];
    for (let i = 1; i < path.length - 1; i++) {
        const prev = out[out.length - 1], cur = path[i], next = path[i + 1];
        const cross = (cur.x - prev.x) * (next.z - cur.z) - (cur.z - prev.z) * (next.x - cur.x);
        if (Math.abs(cross) > 0.5) out.push(cur);
    }
    out.push(path[path.length - 1]);
    return out;
}

function getNavArrowTarget() {
    if (currentNavPath.length === 0) return beaconGroup.position;
    const advanceDist = NAV_CELL * 1.5;
    while (currentNavIndex < currentNavPath.length - 1) {
        const wp = currentNavPath[currentNavIndex];
        const dx = playerGroup.position.x - wp.x;
        const dz = playerGroup.position.z - wp.z;
        if (dx * dx + dz * dz < advanceDist * advanceDist) {
            currentNavIndex++;
        } else {
            break;
        }
    }
    return currentNavPath[currentNavIndex] || beaconGroup.position;
}

function updateWantedSystem() {
    if (!policeTemplate || !policeClips) return;

    let targetEnemyCount = 0;
    if (score >= WANTED_LEVEL_2_SCORE) {
        targetEnemyCount = 2; 
    } else if (score >= WANTED_LEVEL_1_SCORE) {
        targetEnemyCount = 1; 
    }
    
    if (activeEnemies.length < targetEnemyCount) {
        const toSpawn = targetEnemyCount - activeEnemies.length;
        for (let i = 0; i < toSpawn; i++) {
            createNewEnemy();
        }
    }
    
    activeEnemies.forEach((enemy) => {
        enemy.isChasing = false; 
        
        // OLD: let pos = getAnywhereSpawnPoint(beaconGroup.position, 10, 80);
        
        // NEW: Patrols a wider area (100 to 300 units) around the beacon
        let pos = getAnywhereSpawnPoint(beaconGroup.position, 100, 300);
        
        if (pos) {
            enemy.patrolTarget = pos;
        } else {
            enemy.patrolTarget = beaconGroup.position.clone();
        }
    });
}

function createNewEnemy() {
    console.log("Spawning NEW Police Officer");
    
    if (!policeTemplate) {
        console.warn("Police template not loaded yet");
        return;
    }

    // 1. USE SKELETON UTILS TO FIX SQUASHING
    const mesh = SkeletonUtils.clone(policeTemplate);
    
    // 2. APPLY SCALE & VISIBILITY SETTINGS
    mesh.scale.set(4, 4, 4); 
    mesh.position.y = 0.0; 
    
    // Force the browser to always draw the police, even if it thinks they are off-screen
    mesh.traverse(o => { 
        if (o.isMesh) {
            o.frustumCulled = false; 
            o.castShadow = true;
            o.receiveShadow = true;
        }
    });

    // 3. ADD TO SCENE
    enemiesGroup.add(mesh);
    
    // 4. POSITION
    // OLD: let pos = getAnywhereSpawnPoint(beaconGroup.position, 10, 50);
    
    // NEW: Spawns new police 150 to 400 units away from the beacon
    let pos = getAnywhereSpawnPoint(beaconGroup.position, 150, 400);
    
    if (pos) {
        mesh.position.copy(pos);
    } else {
        mesh.position.copy(beaconGroup.position);
    }

    // 5. ANIMATIONS (Your existing logic)
    const mixer = new THREE.AnimationMixer(mesh);
    const actions = {};
    
    // Map your specific animation names
    const idleClip = THREE.AnimationClip.findByName(policeClips, 'Idle');
    const runningClip = THREE.AnimationClip.findByName(policeClips, 'Running'); 
    const fastRunClip = THREE.AnimationClip.findByName(policeClips, 'Fast Run');
    const hookClip = THREE.AnimationClip.findByName(policeClips, 'Hook');
    const walkClip = THREE.AnimationClip.findByName(policeClips, 'Walk');
    
    if (idleClip) actions['Idle'] = mixer.clipAction(idleClip);
    
    // Use 'Walk' for Patrol (slowed down)
    if (runningClip) {
        actions['Patrol'] = mixer.clipAction(walkClip);
        actions['Patrol'].timeScale = 1; 
    }
    
    // Use 'Fast Run' for Chase (or fallback to Running)
    if (fastRunClip) {
        actions['Chase'] = mixer.clipAction(fastRunClip);
    } else if (runningClip) {
        actions['Chase'] = mixer.clipAction(runningClip); 
    }
    
    if (hookClip) actions['Hook'] = mixer.clipAction(hookClip);
    
    // Start Idle
    const currentAction = actions['Idle'];
    if (currentAction) currentAction.play();
    
    // Add the red/blue light
    const light = new THREE.PointLight(0xff0000, 2, 10);
    light.position.set(0, 4, 0);
    mesh.add(light);

    // 6. SAVE TO ARRAY (Note: We track 'mesh' directly now, not a wrapper group)
    activeEnemies.push({
        groupRef: mesh, // Important: The AI logic uses 'groupRef', so we set it to our mesh
        mesh: mesh,
        mixer: mixer,
        actions: actions,
        currentAction: currentAction,
        state: 'PATROL',  
        patrolTarget: null,
        patrolTimer: 0
    });
}

function spawnRoamingNPC() {
    if (!playerMesh || roamingNPCs.length >= MAX_ROAMING_NPCS) return;

    const pos = getAnywhereSpawnPoint(playerGroup.position, 30, 150);
    if (!pos) return;

    // Clone the player model as placeholder
    const mesh = SkeletonUtils.clone(playerMesh);
    mesh.scale.set(2.0, 2.0, 2.0);
    mesh.position.copy(pos);
    // Give them a random tint so they're distinguishable
    mesh.traverse(o => {
        if (o.isMesh && o.material) {
            o.material = o.material.clone();
            o.material.color.setHSL(Math.random(), 0.4, 0.6);
        }
    });
    scene.add(mesh);

    // Give them their own mixer using the player's clips
    const npcMixer = new THREE.AnimationMixer(mesh);
    const idleClip = THREE.AnimationClip.findByName(mixer._root._clips || [], 'Idle');
    
    // Grab clips directly from animationsMap's underlying clips
    const idleAction = npcMixer.clipAction(animationsMap.get('Idle')._clip);
    const runAction  = npcMixer.clipAction(animationsMap.get('Run')._clip);
    idleAction.play();

    const target = getAnywhereSpawnPoint(pos, 20, 80) || pos.clone();

    roamingNPCs.push({
        mesh, mixer: npcMixer,
        idleAction, runAction,
        currentAction: idleAction,
        target,
        waitTimer: 0,
        state: 'WALK'
    });
}

function spawnPowerup() {
    if (powerups.length >= MAX_POWERUPS) return;

    // Spawn in a ring around the player rather than anywhere in a 3600-unit disc.
    // The old map-wide scatter only felt dense because nothing was ever removed;
    // with a live budget, keeping pickups near the player is what makes them
    // findable — and it lets the distance cull recycle them as you ride on.
    const pos = getAnywhereSpawnPoint(playerGroup.position, 60, POWERUP_SPAWN_RADIUS);

    if (!pos) return;

    const roll = Math.random();
    let type = 'bike';
    if (roll > 0.80) type = 'armor_tee';
    else if (roll > 0.60) type = 'armor_belt';
    else if (roll > 0.30) type = 'drink';

    createPowerupGroup(type, pos);
}

// --- PICKUP GLOW ---
// Replaces the old cartoon star. Beyond looking better, the star built a fresh
// 256px canvas + CanvasTexture per pickup and never disposed it — with pickups
// spawning twice a second that leaked ~125MB of GPU memory over a round.
// Everything below is created once and shared by every pickup in the game.

let glowTexture = null;
function getGlowTexture() {
    if (glowTexture) return glowTexture;
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const c = size / 2;

    // Tight hot core falling off into a wide, very soft halo. The long tail is
    // what stops it reading as a hard-edged decal.
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0.00, 'rgba(255,255,255,1.00)');
    g.addColorStop(0.12, 'rgba(255,252,235,0.90)');
    g.addColorStop(0.28, 'rgba(255,236,170,0.45)');
    g.addColorStop(0.50, 'rgba(255,210,110,0.16)');
    g.addColorStop(0.75, 'rgba(255,180,70,0.04)');
    g.addColorStop(1.00, 'rgba(255,160,50,0.00)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);

    glowTexture = new THREE.CanvasTexture(canvas);
    glowTexture.colorSpace = THREE.SRGBColorSpace;
    return glowTexture;
}

// One material per colour, shared across all pickups of that type, so the pulse
// is a single opacity write per frame rather than one per pickup.
const glowMaterialCache = new Map();
function getGlowMaterial(color, baseOpacity) {
    const key = `${color}_${baseOpacity}`;
    let mat = glowMaterialCache.get(key);
    if (mat) return mat;
    mat = new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color: color,
        transparent: true,
        opacity: baseOpacity,
        blending: THREE.AdditiveBlending, // light, not a sticker
        depthWrite: false,
        depthTest: true,                  // still occluded by buildings
        toneMapped: false                 // keep the core genuinely bright
    });
    mat.userData.baseOpacity = baseOpacity;
    glowMaterialCache.set(key, mat);
    return mat;
}

const GLOW_COLORS = {
    bike:       0x7CFF5A,
    drink:      0x5AE8FF,
    armor_tee:  0xFFC83D,
    armor_belt: 0xFF9A3D
};

// Halo + core, both billboarded. Two layers give the falloff real depth.
function createGlow(type) {
    const color = GLOW_COLORS[type] || 0xFFC83D;
    const group = new THREE.Group();

    const halo = new THREE.Sprite(getGlowMaterial(color, 0.55));
    halo.scale.set(9, 9, 1);
    halo.renderOrder = -2;
    group.add(halo);

    const core = new THREE.Sprite(getGlowMaterial(color, 0.85));
    core.scale.set(3.2, 3.2, 1);
    core.renderOrder = -1;
    group.add(core);

    group.position.y = 1.0;
    return group;
}

// Called once per frame for the whole game, not once per pickup.
function updateGlowPulse(elapsed) {
    const pulse = 0.78 + Math.sin(elapsed * 2.6) * 0.22;
    glowMaterialCache.forEach(mat => {
        mat.opacity = mat.userData.baseOpacity * pulse;
    });
}

function createPowerupGroup(type, pos) {
    const group = new THREE.Group();
    group.position.copy(pos);

    // --- ADJUST THIS VALUE TO MOVE MODELS DOWN ---
    const Y_OFFSET = -1.0;

    if (type === 'bike') {
        if (bikeTemplate) {
            const mesh = bikeTemplate.clone();
            mesh.position.y = Y_OFFSET; // <--- ADD THIS
            group.add(mesh);
        } else {
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(2,1,0.5), new THREE.MeshBasicMaterial({color: 0x32CD32}));
            mesh.position.y = Y_OFFSET * 1,2; // <--- ADD THIS
            group.add(mesh);
        }
        group.userData = { type: 'bike', active: true };
    }
    else if (type === 'drink') {
        if (drinkTemplate) group.add(drinkTemplate.clone());
        else {
            // FALLBACK
            const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.3,0.3,0.8), new THREE.MeshBasicMaterial({color: 0x0000FF}));
            group.add(mesh);
        }
        group.userData = { type: 'drink', active: true };
    }
    else if (type === 'armor_tee') {
        const useGrey = Math.random() > 0.5;
        let mesh;
        
        if (useGrey && lionTeeGreyTemplate) mesh = lionTeeGreyTemplate.clone();
        else if (!useGrey && lionTeeTemplate) mesh = lionTeeTemplate.clone();
        else {
            // FALLBACK
            mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8,0.8,0.1), new THREE.MeshBasicMaterial({color: 0xFFD700}));
        }
        
        // Push the newly scaled model down slightly
        mesh.position.y = -2.5; // <--- Changed from -3.5 to -1.5
        
        group.add(mesh);
        group.userData = { type: 'armor_tee', active: true };
    }
    else if (type === 'armor_belt') { 
        let mesh;
        
        if (beltTemplate) mesh = beltTemplate.clone();
        else {
            // FALLBACK
            mesh = new THREE.Mesh(new THREE.TorusGeometry(0.3,0.05), new THREE.MeshBasicMaterial({color: 0x8B4513}));
        }
        
        // Push the belt down slightly
        mesh.position.y = -1.0; // Tweak as needed
        
        group.add(mesh);
        group.userData = { type: 'armor_belt', active: true };
    }
    
    const glow = createGlow(type);
    group.add(glow);
    group.userData.glow = glow;
    group.userData.bobPhase = Math.random() * Math.PI * 2;

    scene.add(group);
    powerups.push(group);
}

// Clones share geometry, materials and textures with their template, and the glow
// uses cached shared materials — so removal is just an unlink. Disposing here
// would destroy the template every other pickup still depends on.
function removePowerup(index) {
    const p = powerups[index];
    if (!p) return;
    scene.remove(p);
    p.userData.active = false;
    powerups.splice(index, 1);
}




window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); }
    if (keys.hasOwnProperty(k)) keys[k] = true;
    if (k === ' ') keys.space = true;
    if (e.key === 'ArrowUp')    { e.preventDefault(); keys.w = true; }
    if (e.key === 'ArrowDown')  { e.preventDefault(); keys.s = true; }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); keys.a = true; }
    if (e.key === 'ArrowRight') { e.preventDefault(); keys.d = true; }
    if (k === 'p') isPaused = !isPaused;
    if (k === 'm') isMapOpen = !isMapOpen;
    if (k === 't') { isTimerRunning = !isTimerRunning; }
    if (k === 'i') toggleStats();
});
window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (keys.hasOwnProperty(k)) keys[k] = false;
    if (k === ' ') {
        keys.space = false;
        jumpLocked = false;
    }
    if (e.key === 'ArrowUp')    keys.w = false;
    if (e.key === 'ArrowDown')  keys.s = false;
    if (e.key === 'ArrowLeft')  keys.a = false;
    if (e.key === 'ArrowRight') keys.d = false;
});

const clock = new THREE.Clock();

// --- ADAPTIVE RESOLUTION ---
// If the device can't hold framerate, trade pixels for it before the user notices
// stutter. Rises back once there's headroom, so desktops aren't punished.
let qualityScale = 1.0;
let fpsAccum = 0, fpsFrames = 0, fpsWindow = 0;
let lastFps = 0;

function updateAdaptiveQuality(delta) {
    fpsAccum += delta;
    fpsFrames++;
    fpsWindow += delta;
    if (fpsWindow < 2.0) return;

    const fps = fpsFrames / fpsAccum;
    fpsAccum = 0; fpsFrames = 0; fpsWindow = 0;

    const prev = qualityScale;
    if (fps < 26 && qualityScale > 0.7) qualityScale -= 0.15;
    else if (fps > 52 && qualityScale < 1.0) qualityScale += 0.1;
    qualityScale = Math.max(0.7, Math.min(1.0, qualityScale));

    if (qualityScale !== prev) {
        renderer.setPixelRatio(targetPixelRatio() * qualityScale);
        if (composer) composer.setPixelRatio(targetPixelRatio() * qualityScale);
    }
    lastFps = fps;
}

// --- STATS OVERLAY (press I, or use the pause menu on mobile) ---
let statsEl = null;
let statsTimer = 0;
function toggleStats() {
    if (statsEl) { statsEl.remove(); statsEl = null; return; }
    statsEl = document.createElement('pre');
    statsEl.style.cssText = `
        position:fixed; bottom:8px; left:8px; z-index:99998;
        background:rgba(0,0,0,0.8); color:#0f0; font:11px/1.4 monospace;
        padding:6px 8px; border:1px solid #0f0; border-radius:4px;
        margin:0; pointer-events:none; white-space:pre;`;
    document.body.appendChild(statsEl);
}
window.toggleStats = toggleStats;

function updateStats(delta) {
    if (!statsEl) return;
    statsTimer += delta;
    if (statsTimer < 0.25) return;
    statsTimer = 0;
    const s = rendererStats();
    statsEl.textContent =
        `fps      ${lastFps.toFixed(0)}  (scale ${qualityScale.toFixed(2)})\n` +
        `draws    ${s.calls}\n` +
        `tris     ${(s.tris / 1000).toFixed(0)}k\n` +
        `textures ${s.textures}\n` +
        `geoms    ${s.geometries}\n` +
        `pickups  ${s.powerups}/${MAX_POWERUPS}\n` +
        `police   ${s.enemies}`;
}

function animate() {
    requestAnimationFrame(animate);

    const rawDelta = clock.getDelta();
    const delta = Math.min(rawDelta, 0.05);

    updateAdaptiveQuality(rawDelta);
    updateStats(delta);

    
    // Update Player Animations (Human or Bike)
    if (hasBike && bikeMixer) {
        bikeMixer.update(delta);
    } else if (playerMesh && mixer) {
        mixer.update(delta);
    }

    // --- NEW: UPDATE CUSTOMER ANIMATION ---
    if (customerMixer) {
        customerMixer.update(delta);
    }


    
    updateUI();

    if (isPaused) return;

    beaconMesh.material.opacity = 0.5 + Math.sin(clock.elapsedTime * 4) * 0.2;

    if (gameActive) {
        if (isTimerRunning) timeLeft -= delta;
        spawnTimer += delta;
        if (spawnTimer > POWERUP_SPAWN_RATE) {
            spawnPowerup();
            spawnTimer = 0;
        }

        // Retry path if it failed at spawn (e.g. navGrid wasn't ready yet)
        pathRetryTimer += delta;
        if (currentNavPath.length === 0 && navGrid && pathRetryTimer > 2.0) {
            pathRetryTimer = 0;
            const retried = findRoadPath(playerGroup.position, beaconGroup.position);
            if (retried && retried.length > 0) { currentNavPath = retried; currentNavIndex = 0; }
        }

        if (timeLeft <= 0) {
            timeLeft = 0;
            gameActive = false;
            isBusted = false;
            if (currentAction) currentAction.stop();
        }
    }

    // --- STEALTH & PATROL AI LOGIC ---
    if (gameActive) {
        activeEnemies.forEach((enemy) => {
            if (enemy.mixer) enemy.mixer.update(delta);
            
            const distToPlayer = enemy.groupRef.position.distanceTo(playerGroup.position);
            
            let detected = false;
            
            if (distToPlayer < ENEMY_HEARING_DIST) {
                detected = true;
            } 
            else if (distToPlayer < ENEMY_VISION_DIST) {
                const enemyFwd = new THREE.Vector3(0, 0, 1);
                enemyFwd.applyQuaternion(enemy.groupRef.quaternion).normalize();
                const toPlayer = new THREE.Vector3().subVectors(playerGroup.position, enemy.groupRef.position).normalize();
                const angleRad = enemyFwd.angleTo(toPlayer);
                const angleDeg = THREE.MathUtils.radToDeg(angleRad);
                if (angleDeg < (ENEMY_FOV / 2)) {
                    detected = true;
                }
            }

            if (detected) {
                enemy.state = 'CHASE';
            } else if (enemy.state === 'CHASE' && distToPlayer > ENEMY_VISION_DIST * 1.5) {
                enemy.state = 'PATROL';
                enemy.patrolTarget = null; 
            }

            if (enemy.state === 'CHASE') {
                enemy.groupRef.lookAt(playerGroup.position.x, enemy.groupRef.position.y, playerGroup.position.z);
                const enemyDir = new THREE.Vector3().subVectors(playerGroup.position, enemy.groupRef.position).normalize();
                enemy.groupRef.position.addScaledVector(enemyDir, ENEMY_RUN_SPEED * delta);
                
                if (distToPlayer < ENEMY_CATCH_RADIUS) {
                    gameActive = false;
                    isBusted = true;
                    if (currentAction) currentAction.stop();
                    if (enemy.actions['Hook'] && enemy.currentAction !== enemy.actions['Hook']) {
                        enemy.actions['Hook'].reset().play();
                        if (enemy.currentAction) enemy.currentAction.stop();
                        enemy.currentAction = enemy.actions['Hook'];
                    }
                }
                
                if (enemy.actions['Chase'] && enemy.currentAction !== enemy.actions['Chase']) {
                    enemy.actions['Chase'].reset().play();
                    if (enemy.currentAction) enemy.currentAction.fadeOut(0.2);
                    enemy.currentAction = enemy.actions['Chase'];
                }
            } 
            
            else if (enemy.state === 'PATROL') {
                if (!enemy.patrolTarget) {
                    let p = getAnywhereSpawnPoint(enemy.groupRef.position, 10, 40);
                    if (p) enemy.patrolTarget = p;
                    enemy.patrolTimer = 0;
                }
                
                const distToTarget = enemy.groupRef.position.distanceTo(enemy.patrolTarget);
                
                if (distToTarget < 2.0) {
                    enemy.patrolTimer += delta;
                    if (enemy.patrolTimer > 2.0) {
                        enemy.patrolTarget = null; 
                    }
                    if (enemy.actions['Idle'] && enemy.currentAction !== enemy.actions['Idle']) {
                        enemy.actions['Idle'].reset().play();
                        if (enemy.currentAction) enemy.currentAction.fadeOut(0.2);
                        enemy.currentAction = enemy.actions['Idle'];
                    }
                } else {
                    enemy.groupRef.lookAt(enemy.patrolTarget.x, enemy.groupRef.position.y, enemy.patrolTarget.z);
                    const walkDir = new THREE.Vector3().subVectors(enemy.patrolTarget, enemy.groupRef.position).normalize();
                    enemy.groupRef.position.addScaledVector(walkDir, ENEMY_WALK_SPEED * delta);
                    
                    if (enemy.actions['Patrol'] && enemy.currentAction !== enemy.actions['Patrol']) {
                        enemy.actions['Patrol'].reset().play();
                        if (enemy.currentAction) enemy.currentAction.fadeOut(0.2);
                        enemy.currentAction = enemy.actions['Patrol'];
                    }
                }
            }

            raycaster.set(new THREE.Vector3(enemy.groupRef.position.x, 300, enemy.groupRef.position.z), downVector);
            const hits = raycaster.intersectObjects(colliderMeshes, false);
            if (hits.length > 0) {
                enemy.groupRef.position.y = THREE.MathUtils.lerp(enemy.groupRef.position.y, hits[0].point.y, 5 * delta);
            }
        });
    }

    // ROAMING NPCs
    if (gameActive) {
        roamingNPCs.forEach(npc => {
            npc.mixer.update(delta);

            if (npc.state === 'WAIT') {
                npc.waitTimer -= delta;
                if (npc.waitTimer <= 0) {
                    const newTarget = getAnywhereSpawnPoint(npc.mesh.position, 20, 100);
                    if (newTarget) npc.target = newTarget;
                    npc.state = 'WALK';
                    if (npc.currentAction !== npc.runAction) {
                        npc.runAction.reset().fadeIn(0.2).play();
                        if (npc.currentAction) npc.currentAction.fadeOut(0.2);
                        npc.currentAction = npc.runAction;
                    }
                }
                return;
            }

            const dist = npc.mesh.position.distanceTo(npc.target);
            if (dist < 3.0) {
                npc.state = 'WAIT';
                npc.waitTimer = 2.0 + Math.random() * 3.0;
                if (npc.currentAction !== npc.idleAction) {
                    npc.idleAction.reset().fadeIn(0.2).play();
                    if (npc.currentAction) npc.currentAction.fadeOut(0.2);
                    npc.currentAction = npc.idleAction;
                }
            } else {
                // Walk toward target
                const dir = new THREE.Vector3().subVectors(npc.target, npc.mesh.position).normalize();
                npc.mesh.position.addScaledVector(dir, NPC_WALK_SPEED * delta);
                npc.mesh.lookAt(npc.target.x, npc.mesh.position.y, npc.target.z);

                // Ground snap
                raycaster.set(
                    new THREE.Vector3(npc.mesh.position.x, npc.mesh.position.y + 10, npc.mesh.position.z),
                    downVector
                );
                const hits = raycaster.intersectObjects(colliderMeshes, false);
                if (hits.length > 0) {
                    npc.mesh.position.y = THREE.MathUtils.lerp(npc.mesh.position.y, hits[0].point.y, 10 * delta);
                }
            }
        });
    }

    if (gameActive) {
        // One opacity write covers every glow on screen.
        updateGlowPulse(clock.elapsedTime);

        for (let i = powerups.length - 1; i >= 0; i--) {
            const p = powerups[i];
            const distToPlayer = playerGroup.position.distanceTo(p.position);

            // Cull pickups the player has left far behind, freeing budget for
            // fresh ones ahead. Without this the array only ever grew.
            if (distToPlayer > POWERUP_DESPAWN_DIST) {
                removePowerup(i);
                continue;
            }

            if (p.userData.type !== 'bike') {
                p.rotation.y += delta;
            }
            if (p.userData.glow) {
                p.userData.glow.position.y =
                    1.0 + Math.sin(clock.elapsedTime * 1.8 + p.userData.bobPhase) * 0.25;
            }

            if (p.userData.active && distToPlayer < 2.5) {
                if (p.userData.type === 'bike') {
                    hasBike = true;
                } else if (p.userData.type === 'drink') {
                    hasJumpBoost = true;
                } else if (p.userData.type === 'armor_tee') {
                    armor += 2;
                } else if (p.userData.type === 'armor_belt') {
                    armor += 1;
                }

                removePowerup(i);
            }
        }
    }

    if (playerMesh && mixer) {
        mixer.update(delta);

        if (gameActive && !isMapOpen) {
            
            // 1. INPUT
            let forward = 0;
            if (keys.w) forward = 1;
            if (keys.s) forward = -1;
            if (Math.abs(joystickInput.y) > 0.1) forward = joystickInput.y > 0 ? 1 : -1;

            if (keys.a) cameraAngle += cameraRotationSpeed;
            if (keys.d) cameraAngle -= cameraRotationSpeed;
            if (Math.abs(joystickInput.x) > 0.1) cameraAngle -= joystickInput.x * cameraRotationSpeed * 2.0;

            // 2. JUMP
            if (isGrounded) wallJumpsRemaining = 1; // refresh each time player is on ground
            if (keys.space && isGrounded && !jumpLocked) {
                verticalVelocity = JUMP_FORCE;
                isGrounded = false;
                jumpLocked = true;
            }
            // Wall jump: one bonus jump while airborne if a wall is within reach
            if (keys.space && !isGrounded && !jumpLocked && wallJumpsRemaining > 0) {
                const wallOrigin = playerGroup.position.clone();
                wallOrigin.y += 1;
                let wallFound = false;
                for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
                    raycaster.set(wallOrigin, new THREE.Vector3(Math.sin(a), 0, Math.cos(a)));
                    const hits = raycaster.intersectObjects(colliderMeshes, false);
                    if (hits.length > 0 && hits[0].distance < 3.0) { wallFound = true; break; }
                }
                if (wallFound) {
                    verticalVelocity = JUMP_FORCE * 0.9;
                    jumpLocked = true;
                    wallJumpsRemaining--;
                }
            }

            // 2c. SUPER JUMP (square button, consumes stored boost)
            if (keys.superJump && isGrounded && !jumpLocked && hasJumpBoost) {
                verticalVelocity = SUPER_JUMP_FORCE;
                isGrounded = false;
                jumpLocked = true;
                hasJumpBoost = false;
            }

            // 2b. PUNCH
            if (keys.punch && !hasBike) {
                const punchAnim = animationsMap.get('Punch');
                if (punchAnim && currentAction !== punchAnim) {
                    punchAnim.clampWhenFinished = true;
                    punchAnim.reset().setLoop(THREE.LoopOnce).play();
                    if (currentAction) currentAction.fadeOut(0.1);
                    currentAction = punchAnim;

                    // Check for NPCs in punch range (3 units in front of player)
                    const punchDir = new THREE.Vector3(Math.sin(cameraAngle), 0, Math.cos(cameraAngle));
                    for (let i = roamingNPCs.length - 1; i >= 0; i--) {
                        const npc = roamingNPCs[i];
                        const toNPC = new THREE.Vector3().subVectors(npc.mesh.position, playerGroup.position);
                        const dist = toNPC.length();
                        const dot = toNPC.normalize().dot(punchDir);
                        if (dist < 4.0 && dot > 0.4) {
                            // NPC is in front and close — destroy it
                            scene.remove(npc.mesh);
                            roamingNPCs.splice(i, 1);
                            // Spawn a replacement somewhere else
                            setTimeout(() => spawnRoamingNPC(), 3000);
                        }
                    }
                }
            }

            // 3. MOVEMENT
            if (forward !== 0) {
                let currentSpeed = BASE_SPEED;
                if (hasBike) currentSpeed *= BIKE_MULTIPLIER;

                const dirX = Math.sin(cameraAngle);
                const dirZ = Math.cos(cameraAngle);
                const moveVec = new THREE.Vector3(dirX * forward, 0, dirZ * forward).normalize();

                // --- NEW: SLIDING COLLISION ---
                const allowedMove = calculateMovement(playerGroup.position, moveVec, currentSpeed, delta);
                playerGroup.position.add(allowedMove);
                // ------------------------------

                const targetRotation = cameraAngle + (forward > 0 ? 0 : Math.PI); 
                let rotDiff = targetRotation - playerMesh.rotation.y;
                while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
                while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
                
                const newRot = playerMesh.rotation.y + rotDiff * 0.1;
                playerMesh.rotation.y = newRot;

                // Add + Math.PI/2 (90 deg) or - Math.PI/2 (-90 deg) depending on the model
                if (playerBikeMesh) playerBikeMesh.rotation.y = newRot + (Math.PI / 2);

                // HUMAN ANIMATION: moving
                if (!hasBike) {
                    const punchAnim = animationsMap.get('Punch');
                    const isPunching = punchAnim && currentAction === punchAnim && punchAnim.isRunning();
                    if (!isPunching) {
                        if (!isGrounded) {
                            const jumpAnim = animationsMap.get('Jump');
                            if (jumpAnim && currentAction !== jumpAnim) {
                                jumpAnim.reset().setLoop(THREE.LoopOnce).play();
                                jumpAnim.clampWhenFinished = true;
                                if (currentAction) currentAction.fadeOut(0.15);
                                currentAction = jumpAnim;
                            }
                        } else {
                            const run = animationsMap.get('Run');
                            if (run && currentAction !== run) {
                                run.reset().fadeIn(0.2).play();
                                if (currentAction) currentAction.fadeOut(0.2);
                                currentAction = run;
                            }
                            if (currentAction === run) {
                                currentAction.timeScale = (currentSpeed / BASE_SPEED) * 1.2;
                            }
                        }
                    }
                }

                // BIKE ANIMATION: moving
                if (hasBike && bikeActions.length > 0) {
                    bikeActions.forEach(action => { action.paused = false; action.play(); });
                }

            } else {
                // forward === 0

                // HUMAN ANIMATION: idle or airborne
                if (!hasBike) {
                    const punchAnim = animationsMap.get('Punch');
                    const isPunching = punchAnim && currentAction === punchAnim && punchAnim.isRunning();
                    if (!isPunching) {
                        if (!isGrounded) {
                            const jumpAnim = animationsMap.get('Jump');
                            if (jumpAnim && currentAction !== jumpAnim) {
                                jumpAnim.reset().setLoop(THREE.LoopOnce).play();
                                jumpAnim.clampWhenFinished = true;
                                if (currentAction) currentAction.fadeOut(0.15);
                                currentAction = jumpAnim;
                            }
                        } else {
                            const idle = animationsMap.get('Idle');
                            if (idle && currentAction !== idle) {
                                idle.reset().fadeIn(0.2).play();
                                if (currentAction) currentAction.fadeOut(0.2);
                                currentAction = idle;
                                currentAction.timeScale = 1.0;
                            }
                        }
                    }
                }

                // BIKE ANIMATION: idle
                if (hasBike && bikeActions.length > 0) {
                    bikeActions.forEach(action => { action.paused = true; });
                }
            }

                // 4. PHYSICS (Gravity)
                verticalVelocity += GRAVITY * delta;

                // Ceiling check BEFORE position update — ray looks ahead by movement distance
                if (verticalVelocity > 0) {
                    const moveAmount = verticalVelocity * delta;
                    const ceilOrigin = playerGroup.position.clone();
                    ceilOrigin.y += 0.1;
                    raycaster.set(ceilOrigin, new THREE.Vector3(0, 1, 0));
                    const ceilHits = raycaster.intersectObjects(colliderMeshes, false);
                    if (ceilHits.length > 0 && ceilHits[0].distance < moveAmount + 2.0) {
                        // Surface is within reach this frame — stop just below it
                        playerGroup.position.y = ceilHits[0].point.y - 2.5;
                        verticalVelocity = 0;
                    } else {
                        playerGroup.position.y += moveAmount;
                    }
                } else {
                    playerGroup.position.y += verticalVelocity * delta;
                }

                // Ground check
                const groundOrigin = playerGroup.position.clone();
                groundOrigin.y += 3.0;
                raycaster.set(groundOrigin, downVector);
                const groundHits = raycaster.intersectObjects(colliderMeshes, false);

                if (groundHits.length > 0) {
                    const hitY = groundHits[0].point.y;
                    const distToFloor = playerGroup.position.y - hitY;
                    if (distToFloor <= 0.3 && verticalVelocity <= 0) {
                        playerGroup.position.y = hitY;
                        verticalVelocity = 0;
                        isGrounded = true;
                    } else if (distToFloor < -0.1) {
                        playerGroup.position.y = hitY;
                        verticalVelocity = 0;
                        isGrounded = true;
                    } else {
                        isGrounded = false;
                    }
                } else {
                    isGrounded = false;
                }
            
            // 5. Fallback Check
            if (playerGroup.position.y < -50) {
                console.log("Respawning...");
                let safeSpot = getAnywhereSpawnPoint(new THREE.Vector3(0,0,0), 0, 200);
                if (safeSpot) {
                    playerGroup.position.copy(safeSpot);
                    playerGroup.position.y += 5.0; 
                } else {
                    playerGroup.position.set(0, 20, 0); 
                }
                verticalVelocity = 0;
                isGrounded = false;
            }

            getNavArrowTarget(); // advances currentNavIndex as player moves along path

            // Ground-presence timer — must outlast a full normal jump (≈1 s)
            if (isGrounded) {
                navLineGroundTimer = 3.0;
            } else {
                navLineGroundTimer = Math.max(0, navLineGroundTimer - delta);
            }

            const lineActive = currentNavPath.length > 0 && navLineGroundTimer > 0;

            // Cone: only visible when no route line is showing; points straight at beacon
            arrowMesh.visible = !lineActive;
            if (!lineActive) {
                arrowMesh.lookAt(beaconGroup.position.x, 4, beaconGroup.position.z);
            }

            // Route line — geometry rebuilt at ~8 fps to avoid per-frame Catmull-Rom cost
            navLineUpdateTimer += delta;
            if (lineActive) {
                if (navLineUpdateTimer >= 0.12) {
                    navLineUpdateTimer = 0;
                    const LINE_LIFT = 0.4;
                    const SKIP_DIST = 12;
                    const rawPts = [];
                    const firstWp = currentNavPath[currentNavIndex] || beaconGroup.position;
                    const toFirst = new THREE.Vector3().subVectors(firstWp, playerGroup.position);
                    if (toFirst.length() > SKIP_DIST) {
                        const skipStart = playerGroup.position.clone()
                            .addScaledVector(toFirst.normalize(), SKIP_DIST);
                        skipStart.y += LINE_LIFT;
                        rawPts.push(skipStart);
                    }
                    for (let pi = currentNavIndex; pi < currentNavPath.length; pi++) {
                        const wp = currentNavPath[pi].clone();
                        wp.y += LINE_LIFT;
                        rawPts.push(wp);
                    }
                    if (rawPts.length >= 2) {
                        const curve = new THREE.CatmullRomCurve3(rawPts);
                        const smooth = curve.getPoints(Math.max(rawPts.length * 5, 30));
                        const flat = [];
                        for (const p of smooth) flat.push(p.x, p.y, p.z);
                        navLineGeo.setPositions(flat);
                        navLine.computeLineDistances();
                    }
                }
                navLine.visible = true;
            } else {
                navLine.visible = false;
                navLineUpdateTimer = 0.12; // force immediate rebuild when line next activates
            }
            if (playerGroup.position.distanceTo(beaconGroup.position) < 10) { 
                score++;
                timeLeft += TIME_BONUS;
                spawnBeacon();
            }
        }

    

// MODEL SWAP LOGIC
    if (playerMesh && playerBikeMesh) {
        playerMesh.visible = !hasBike;
        playerBikeMesh.visible = hasBike;
    }
    
    // RENDER — composer on desktop, plain render on iOS
    if (composer) composer.render();
    else renderer.render(scene, camera);
}

// CAMERA
     let targetPos, targetLook;
     let targetFogNear, targetFogFar;

     if (isMapOpen) {
         targetPos = playerGroup.position.clone().add(new THREE.Vector3(0, 200, 0)); 
        targetLook = playerGroup.position.clone();
         targetFogNear = 150;
         targetFogFar = 800;
         beaconGroup.scale.set(4, 4, 4); 
         arrowMesh.scale.set(4, 4, 4);
     } else {
        const offset = new THREE.Vector3(0, 6, -10).applyAxisAngle(new THREE.Vector3(0,1,0), cameraAngle);
         targetPos = playerGroup.position.clone().add(offset);
        targetLook = playerGroup.position.clone().add(new THREE.Vector3(0, 2, 0));
        targetFogNear = 1500; 
         targetFogFar = 3000;
         beaconGroup.scale.set(1, 1, 1);
         arrowMesh.scale.set(1, 1, 1);
     }

    camera.position.lerp(targetPos, 0.1);
    currentLookAt.lerp(targetLook, 0.1);
    camera.lookAt(currentLookAt);
        
             scene.fog.near = THREE.MathUtils.lerp(scene.fog.near, targetFogNear, 0.05);
    scene.fog.far = THREE.MathUtils.lerp(scene.fog.far, targetFogFar, 0.05);

    // UPDATE BOKEH FOCUS (Keep player sharp) — skipped on iOS
    if (playerGroup && bokehPass) {
        const distToCam = camera.position.distanceTo(playerGroup.position);
        bokehPass.uniforms['focus'].value = distToCam;
    }
 }

animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (composer) composer.setSize(window.innerWidth, window.innerHeight);
    
    renderer.setPixelRatio(targetPixelRatio() * qualityScale);
    navLineMat.resolution.set(window.innerWidth, window.innerHeight);

    // --- NEW: REBUILD JOYSTICK ON RESIZE ---
    if (typeof initJoystick === 'function') {
        initJoystick();
    }
});

window.spawnPolice = () => {
    if (!policeTemplate) return console.warn("Police template not loaded yet");
    createNewEnemy();
};

window.debugSpawn = (forcedType) => {
    if (document.activeElement) document.activeElement.blur();
    const playerPos = playerGroup.position;
    const pos = getAnywhereSpawnPoint(playerPos, 5, 20);
    if (!pos) {
        console.warn("No spawn spot found");
        return;
    }
    createPowerupGroup(forcedType, pos);
};

// Define your list of maps
const mapList = ['shoreditch.glb', 'archway.glb', 'carnabyst.glb'];

