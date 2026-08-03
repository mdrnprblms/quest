import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// --- POST-PROCESSING IMPORTS ---
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// --- PHYSICS ACCELERATION ---
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

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

// --- TITLE SCREEN ---
// Single zone. Shoreditch is the only map with DATA_ROAD geometry exported, so
// it's the only one where the nav grid and road spawning actually work; the
// others fell back to raycasting ground colliders. Keeping the start behind a
// tap also means the 90MB map download begins on a user gesture rather than on
// page load.
const titleScreen = document.createElement('div');
titleScreen.id = 'title-screen';
titleScreen.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: linear-gradient(rgba(0, 0, 0, 0.75), rgba(0, 0, 0, 0.5)), url('menubg.jpg') center/cover no-repeat;
    display: flex; justify-content: center; align-items: center; flex-direction: column;
    z-index: 9998; font-family: 'Helvetica', Arial, sans-serif; color: white;
`;

titleScreen.innerHTML = `
    <img src="mdrnquestlogo.png" alt="Mdrn Quest Logo" style="width: 85vw; max-width: 400px; margin-bottom: 10px;">

    <h1 style="font-family: 'Medieval', serif; color: #ffffff; font-size: 35px; text-align: center; margin-bottom: 20px; text-shadow: 2px 2px 5px #000; padding: 0 20px;">SHOREDITCH</h1>

    <p style="font-family: 'Helvetica', Arial, sans-serif; color: #cccccc; font-size: 16px; text-align: center; margin: 0 0 28px; max-width: 400px; padding: 0 20px;">
        Deliver your packages before the shift ends. Built from real Google Maps data.
    </p>

    <div id="start-card" style="cursor: pointer; text-align: center; background: #222; padding: 10px; border-radius: 8px; border: 2px solid #444; transition: 0.2s; width: 60vw; max-width: 260px;">
        <img src="shoreditch.jpg" alt="Shoreditch" style="width: 100%; height: 22vh; max-height: 150px; object-fit: cover; border-radius: 4px; margin-bottom: 10px;">
        <div style="font-size: 18px; font-weight: bold; letter-spacing: 1px;">START SHIFT</div>
    </div>

    <!-- CC-BY requires attribution wherever the work is distributed. Keep this
         visible (and keep CREDITS.md) if the knight model stays in the game. -->
    <div style="position: absolute; bottom: 12px; left: 0; right: 0; text-align: center;
                font-family: 'Helvetica', Arial, sans-serif; font-size: 11px; line-height: 1.5;
                color: #9a9a9a; padding: 0 16px;">
        &ldquo;<a href="https://skfb.ly/ouuWC" target="_blank" rel="noopener" style="color:#c9c9c9;">PS1 PSX Knight</a>&rdquo;
        by crimsongcat, licensed under
        <a href="http://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener" style="color:#c9c9c9;">CC BY 4.0</a>
    </div>
`;

document.body.appendChild(titleScreen);

const startCard = titleScreen.querySelector('#start-card');
startCard.addEventListener('mouseenter', () => startCard.style.borderColor = '#ffffff');
startCard.addEventListener('mouseleave', () => startCard.style.borderColor = '#444');
startCard.addEventListener('click', () => {
    titleScreen.style.display = 'none';
    timeLeft = START_TIME;
    gameActive = true;
    loadLevel(currentMapName);
});

// --- GAME LOOP ---
const keys = { w: false, a: false, s: false, d: false, space: false, k: false, punch: false, superJump: false };
let cameraAngle = 0;
const cameraRotationSpeed = 0.03;

// Chase camera. Pitch starts at the angle the old fixed (0, 6, -10) offset gave,
// so the default view is unchanged; drag now moves both.
const CAMERA_DISTANCE   = Math.hypot(6, 10);
const CAMERA_PITCH_MIN  = 0.08;   // just above ground level
const CAMERA_PITCH_MAX  = 1.25;   // near top-down, short of gimbal trouble
const CAMERA_DRAG_YAW   = 0.005;  // radians per pixel
const CAMERA_DRAG_PITCH = 0.004;
let cameraPitch = Math.atan2(6, 10);
const currentLookAt = new THREE.Vector3(0, 0, 0);

let roamingNPCs = []; // civilian roamers — hostile once you get close
const NPC_WALK_SPEED = 4.0;
const MAX_ROAMING_NPCS = 8;

// --- BRAWLING ---------------------------------------------------------------
// NPCs wander until the player comes near, then close in and throw punches.
// Aggro is deliberately shorter than the police vision cone: they're a nuisance
// you can walk away from, not a second pursuit.
const NPC_CHASE_SPEED     = 6.0;   // a shade slower than the player on foot
const NPC_AGGRO_RADIUS    = 40;
const NPC_LOSE_RADIUS     = 75;    // hysteresis, so they don't flicker in and out
// Close enough to actually be in each other's faces. The knight stands ~4 units
// tall, so anything much over 2.5 leaves a visible gap between the swing and
// the player.
const NPC_PUNCH_RANGE     = 2.4;
const NPC_PUNCH_WINDUP    = 0.35;  // seconds into the swing before it lands
const NPC_PUNCH_COOLDOWN  = 1.5;
const NPC_MAX_HEALTH      = 3;     // punches to drop one
const NPC_RESPAWN_DELAY   = 4000;  // ms

const PLAYER_MAX_HEALTH      = 15; // punches the player can absorb
const PLAYER_PUNCH_RANGE     = 3.4; // a touch longer than theirs, so you can trade
const PLAYER_PUNCH_ARC       = 0.4; // dot product against facing; ~66 deg either side
const PLAYER_PUNCH_COOLDOWN  = 0.4;
const PLAYER_HIT_INVULN      = 0.8; // brief grace after a hit, so a crowd can't stunlock

// --- TRAFFIC ----------------------------------------------------------------
// Cars drive the same road graph the navigation arrow follows: findRoadPath()
// already snaps to road cells and returns waypoints carrying the road surface
// height, so a car just walks that list. Being hit ends the run.
const CAR_FILES        = ['honda_jazz_ps1.glb', 'volkswagen_golf_ps1.glb'];
const MAX_CARS         = 16;
const CAR_SPEED_MIN    = 22;
const CAR_SPEED_MAX    = 34;
const CAR_SPAWN_MIN    = 140;   // spawn ring around the player, world units
const CAR_SPAWN_MAX    = 420;
const CAR_DESPAWN_DIST = 700;
const CAR_HIT_RADIUS   = 4.5;
const CAR_LENGTH       = 8.0;   // target size along the direction of travel
const CAR_LANE_OFFSET  = 3.5;   // shifted off the road centreline, so both
                                // directions aren't driving down the same line
const CAR_SPAWN_RATE   = 0.5;   // seconds between attempts, until MAX_CARS
const CAR_RAY_HEIGHT   = 10;    // how far above itself a car looks for the road
// Vertical rate limits, in world units per second. Climb is the important one:
// it's what stops a car riding up a scan artefact. At 30 units/s forward, 8/s
// vertical still clears any real gradient in Shoreditch, while a sharp spike
// only lifts the car a few centimetres before it has driven past.
const CAR_MAX_CLIMB_RATE = 8;
const CAR_MAX_FALL_RATE  = 30;
let carTemplates = [];
let cars = [];
let carSpawnTimer = 0;

let playerHealth = PLAYER_MAX_HEALTH;
let playerPunchTimer = 0;   // counts down; player can punch at <= 0
let playerHurtTimer = 0;    // counts down; invulnerable while > 0
let playerHitFlash = 0;     // drives the HUD flash

window.returnToMenu = () => {
    gameActive = false; // Pause the game in the background
    isPaused = false;
    document.getElementById('title-screen').style.display = 'flex';
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
    gameOverReason = 'time';
    isPaused = false;
    hasBike = false;
    hasJumpBoost = false;
    spawnTimer = 0;
    playerHealth = PLAYER_MAX_HEALTH;
    playerPunchTimer = 0;
    playerHurtTimer = 0;
    playerHitFlash = 0;

    // Clear the crowd and the traffic — fresh sets are spawned around the new
    // start position in step 6, once the player has been moved.
    roamingNPCs.forEach(npc => scene.remove(npc.mesh));
    roamingNPCs = [];
    cars.forEach(c => scene.remove(c.mesh));
    cars = [];
    carSpawnTimer = 0;

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
    for (let i = 0; i < 5; i++) spawnRoamingNPC();
    for (let i = 0; i < MAX_CARS; i++) spawnCar();

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

        // The pad is display:none on any device with a fine pointer, which
        // measures zero. Building a zero-size nipple on top of that would put an
        // invisible touch target at the top-left corner of the page.
        if (dynamicSize < 1) {
            joystickManager = null;
            joystickInput.x = 0;
            joystickInput.y = 0;
            return;
        }

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
    // Takes the action directly rather than clicking a hidden HUD button — the
    // on-screen MAP/PAUSE buttons these used to proxy no longer exist.
    function bindMenuButton(buttonId, action) {
        const btn = document.getElementById(buttonId);
        if (!btn) return;

        const pressBtn = (e) => {
            if (e.cancelable) e.preventDefault();
            btn.style.opacity = '0';
            if (navigator.vibrate) navigator.vibrate(20);
            action();
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

    // Bind Triangle to Map, and Start to Pause
    bindMenuButton('btn-triangle', () => window.toggleMap());
    bindMenuButton('btn-start', () => window.togglePause());

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
// Which end-of-run screen to show: 'time' | 'busted' | 'runover'.
let gameOverReason = 'time';

// Single entry point for both toggles, shared by the keyboard (M/P), the
// on-screen controller and the pause menu. They used to be reached by
// synthesising a click on the MAP/PAUSE HUD buttons, which the tidied HUD no
// longer has.
window.togglePause = () => { isPaused = !isPaused; };
window.toggleMap   = () => { isMapOpen = !isMapOpen; };

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
const NAV_SMOOTH_R = 2;     // median-filter radius, in cells, over sampled road heights
let navGrid = null;         // Uint8Array[NAV_DIM*NAV_DIM], 1=road 0=blocked
let navHeightGrid = null;   // Float32Array[NAV_DIM*NAV_DIM], road surface Y per cell
let currentNavPath = [];    // THREE.Vector3[] waypoints along road
let currentNavIndex = 0;
let pathRetryTimer = 0;
let navLineGroundTimer = 0;
let navLineUpdateTimer = 0.12; // start at threshold so first frame draws immediately
let lastTrailWidth = 0;        // forces a rebuild when the map view changes width

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
// The HUD is one bar with no labels on it, so each value has to carry its own
// meaning: position for the score, a clock format for the time, a bar for
// health, and coloured pips for the two temporary states. Every write below is
// guarded against being redundant — updateUI runs every frame and setting
// .textContent on an unchanged node still costs a style recalc.
let _hudCache = { score: -1, armor: -1, stars: '', clock: '', danger: null, bike: null, drink: null };

function updateUI() {
    const uiPause = document.getElementById('pause-screen');
    const uiGameOver = document.getElementById('game-over');

    const warningUI = document.getElementById('zone-warning');
    if (warningUI) warningUI.style.display = 'none';

    const hudScore = document.getElementById('hud-score');
    if (hudScore && score !== _hudCache.score) {
        // Zero-padded so the bar doesn't reflow when the count reaches ten.
        hudScore.textContent = String(score).padStart(2, '0');
        _hudCache.score = score;
    }

    const hudArmor = document.getElementById('hud-armor');
    if (hudArmor && armor !== _hudCache.armor) {
        hudArmor.textContent = `◆ ${armor}`;
        hudArmor.style.display = armor > 0 ? 'inline' : 'none';
        _hudCache.armor = armor;
    }

    const hudStars = document.getElementById('hud-stars');
    if (hudStars) {
        const stars = score >= WANTED_LEVEL_2_SCORE ? '★★'
                    : score >= WANTED_LEVEL_1_SCORE ? '★'
                    : '';
        if (stars !== _hudCache.stars) {
            hudStars.textContent = stars;
            _hudCache.stars = stars;
        }
    }

    const hudTimer = document.getElementById('hud-timer');
    if (hudTimer) {
        const t = Math.max(0, timeLeft);
        // M:SS reads faster than a ticking decimal, and the last ten seconds
        // switch to tenths because at that point the tenths are the tension.
        const clock = t < 10
            ? t.toFixed(1)
            : `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
        if (clock !== _hudCache.clock) {
            hudTimer.textContent = clock;
            _hudCache.clock = clock;
        }
        const danger = t < 10;
        if (danger !== _hudCache.danger) {
            hudTimer.className = danger ? 'danger' : '';
            _hudCache.danger = danger;
        }
    }

    const healthFill = document.getElementById('hud-health-fill');
    if (healthFill) {
        const frac = Math.max(0, playerHealth) / PLAYER_MAX_HEALTH;
        healthFill.style.width = (frac * 100).toFixed(1) + '%';
        // Flashes white on the frame a punch lands, so a hit reads even when
        // the bar barely moves.
        healthFill.style.backgroundColor = playerHitFlash > 0 ? '#ffffff'
            : frac > 0.5 ? '#32CD32' : frac > 0.25 ? '#FFD700' : '#FF3B30';
    }

    const pipBike = document.getElementById('hud-pip-bike');
    const pipDrink = document.getElementById('hud-pip-drink');
    if (pipBike && hasBike !== _hudCache.bike) {
        pipBike.style.display = hasBike ? 'block' : 'none';
        _hudCache.bike = hasBike;
    }
    if (pipDrink && hasJumpBoost !== _hudCache.drink) {
        pipDrink.style.display = hasJumpBoost ? 'block' : 'none';
        _hudCache.drink = hasJumpBoost;
    }
    const statusSep = document.getElementById('hud-status-sep');
    if (statusSep) statusSep.style.display = (hasBike || hasJumpBoost) ? 'block' : 'none';

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
            const titleText = gameOverReason === 'runover' ? "RUN OVER"
                            : gameOverReason === 'busted'  ? "BUSTED"
                            : "SHIFT ENDED";
            const color = gameOverReason === 'runover' ? "#ffcc00"
                        : gameOverReason === 'busted'  ? "#0088ff"
                        : "#ff3333";
            
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

// Near plane deliberately not 0.1. Depth precision is dominated by the near
// plane, so 0.1/3000 (a 30,000:1 ratio) leaves almost none at street distance
// and coplanar road/pavement surfaces z-fight — which reads as the road
// cracking into segments. It only showed on mobile because those GPUs have
// less depth precision to spare. The chase camera sits 10 units back and 6 up,
// so nothing gets clipped by moving this out to 1.0.
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 1.0, 3000);
camera.position.set(0, 20, 20); 

const renderer = new THREE.WebGLRenderer({ antialias: !isIOS, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(targetPixelRatio());
// Shadows cost a second pass over all 1.8M city triangles / 800+ draw calls.
// At a 512px map spanning 600 world units a character is ~3px wide, so on iOS
// we were paying full price for something effectively invisible.
renderer.shadowMap.enabled = !isIOS;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Tone mapping is set below, once we know whether the grade pass came up — it
// does the mapping itself. (The old `useLegacyLights = false` line was dropped:
// it has been the default since r155 and now only prints a deprecation warning.)
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

// --- DRAG TO LOOK ------------------------------------------------------------
// Pointer events cover mouse and touch in one path. Listening on the canvas
// rather than the window means the HUD buttons and the nipplejs joystick — both
// real DOM elements sitting above it — keep their own input untouched.
renderer.domElement.style.touchAction = 'none';   // stop mobile treating a drag as a scroll
{
    let dragPointer = null, lastX = 0, lastY = 0;

    renderer.domElement.addEventListener('pointerdown', (e) => {
        dragPointer = e.pointerId;
        lastX = e.clientX; lastY = e.clientY;
        renderer.domElement.setPointerCapture(e.pointerId);
    });

    const endDrag = (e) => {
        if (dragPointer !== e.pointerId) return;
        dragPointer = null;
        if (renderer.domElement.hasPointerCapture(e.pointerId)) {
            renderer.domElement.releasePointerCapture(e.pointerId);
        }
    };
    renderer.domElement.addEventListener('pointerup', endDrag);
    renderer.domElement.addEventListener('pointercancel', endDrag);

    renderer.domElement.addEventListener('pointermove', (e) => {
        if (dragPointer !== e.pointerId) return;
        cameraAngle -= (e.clientX - lastX) * CAMERA_DRAG_YAW;
        cameraPitch = THREE.MathUtils.clamp(
            cameraPitch + (e.clientY - lastY) * CAMERA_DRAG_PITCH,
            CAMERA_PITCH_MIN, CAMERA_PITCH_MAX
        );
        lastX = e.clientX; lastY = e.clientY;
    });
}

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
// These caps only apply to UNCOMPRESSED textures. The city now ships as
// KTX2/ETC1S and is skipped entirely by optimizeMaterial(), which is why the
// world cap is no longer punishing.
//
// History, so nobody re-introduces the mistake: the city is death by a thousand
// tiles, not a few big textures — shoreditch has 813 images averaging ~512px,
// about 590MB as RGBA8 however you cap the outliers. Capping every tile to
// 128px was the only way to fit iOS's budget, and it gave ~1 texel per world
// unit, which is why buildings rendered as flat colour. Measured:
//     uncapped, uncompressed        1.09 GB   (tab is killed)
//     world 512 / char 1024, uncomp   755 MB  (fine on desktop, fatal on iOS)
//     world 128 / char 512, uncomp     ~95 MB (fit, but looked dreadful)
//     KTX2/ETC1S at full resolution    ~76 MB (fits AND looks right)
// Compression, not resolution, was the right lever.
const TEX_CAP_WORLD = isIOS ? 512 : 1024;  // fallback for any uncompressed city tile
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

        // Compressed (KTX2/ETC1S) textures have no canvas-drawable image and are
        // already inside budget — leave them alone. Trying to redraw one through
        // a 2D canvas would either throw or silently blank the texture.
        if (value.isCompressedTexture) {
            value.anisotropy = isIOS ? 1 : 4;
            continue;
        }

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
    let bytes = 0, count = 0, compressed = 0, largest = 0;
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
                // Compressed textures stay compressed on the GPU. Counting them
                // as RGBA8 would over-report by ~8x and look like a crisis.
                // ETC1S/ASTC 4x4 is 1 byte/texel; x1.33 for the mip chain.
                bytes += t.isCompressedTexture ? w * h * 1.33 : w * h * 4 * 1.33;
                if (t.isCompressedTexture) compressed++;
                largest = Math.max(largest, w, h);
                count++;
            }
        }
    });
    return {
        megabytes: +(bytes / 1048576).toFixed(1),
        textures: count,
        compressed,
        largestPx: largest
    };
}
window.mqTextureBytes = textureBytes;

// --- POST-PROCESSING: CINEMATIC GRADE ---------------------------------------
// What made the game read as flat was never the geometry — it was that the
// image went straight from the renderer to the screen with no camera response
// in between. The city ships as unlit photogrammetry, so nothing in the scene
// produces highlight roll-off, lens falloff or grain; every pixel is exactly
// the albedo that was painted into the texture.
//
// This is one fullscreen pass that fakes a physical camera:
//   exposure -> ACES filmic roll-off -> saturation -> S-curve contrast ->
//   split tone (cool shadows / warm highlights) -> vignette -> grain -> sRGB.
//
// It REPLACES the old RenderPass -> BokehPass -> OutputPass chain, so desktop
// now runs three fullscreen passes fewer than before and is faster despite
// looking better. The bokeh was set to aperture 0.00002 / maxblur 0.01, which
// is visually indistinguishable from off, and it cost a full extra pass with a
// depth prepass behind it.
//
// Tone mapping and the sRGB transfer function are folded into this same shader
// rather than added as a separate OutputPass — that is the whole reason it can
// afford to run on iOS, where previously there was no post at all.
const GradeShader = {
    uniforms: {
        tDiffuse:     { value: null },
        uExposure:    { value: 1.06 },
        uContrast:    { value: 1.14 },
        uSaturation:  { value: 1.16 },
        uWhiteBalance:{ value: new THREE.Vector3(1, 1, 1) },
        uShadowTint:  { value: new THREE.Vector3(0.88, 1.00, 0.96) },
        uHighTint:    { value: new THREE.Vector3(1.05, 1.01, 0.92) },
        uLift:        { value: new THREE.Vector3(0, 0, 0) },
        uVignette:    { value: 0.38 },
        uGrain:       { value: 0.030 },
        uGlare:       { value: 0.22 },
        uAberration:  { value: 0.55 },
        uTime:        { value: 0 }
    },

    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,

    fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform float uExposure, uContrast, uSaturation;
        uniform float uVignette, uGrain, uGlare, uAberration, uTime;
        uniform vec3  uWhiteBalance, uShadowTint, uHighTint, uLift;
        varying vec2 vUv;

        const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

        // Narkowicz's ACES curve fit. Cheaper than the full RRT/ODT that
        // THREE.ACESFilmicToneMapping runs and close enough at this exposure.
        vec3 aces(vec3 x) {
            return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
        }

        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        void main() {
            vec2 c = vUv - 0.5;
            float r = length(c);

            #ifdef USE_ABERRATION
                // Lateral chromatic aberration. A real lens focuses wavelengths
                // at slightly different scales and the error grows with the
                // square of the distance from the optical axis, so the centre of
                // the frame stays clean and only the edges fringe.
                vec2 off = c * r * r * uAberration * 0.006;
                vec3 color = vec3(
                    texture2D(tDiffuse, vUv + off).r,
                    texture2D(tDiffuse, vUv).g,
                    texture2D(tDiffuse, vUv - off).b
                );
            #else
                vec3 color = texture2D(tDiffuse, vUv).rgb;
            #endif

            #ifdef USE_GLARE
                // Four wide taps standing in for a bloom blur. Only the part of
                // each sample above the highlight threshold is scattered back,
                // which is what a bright sky does through real glass — for four
                // extra fetches instead of the six passes a separable blur costs.
                vec3 g = texture2D(tDiffuse, vUv + vec2( 0.016,  0.009)).rgb
                       + texture2D(tDiffuse, vUv + vec2(-0.016,  0.009)).rgb
                       + texture2D(tDiffuse, vUv + vec2( 0.009, -0.016)).rgb
                       + texture2D(tDiffuse, vUv + vec2(-0.009, -0.016)).rgb;
                color += uGlare * max(g * 0.25 - 0.72, 0.0);
            #endif

            // White balance goes in BEFORE the tone curve, where it behaves like
            // a filter screwed onto the lens rather than a tint painted over the
            // finished frame — it corrects the cast instead of covering it.
            color = aces(color * uWhiteBalance * uExposure);

            float l = dot(color, LUMA);
            color = mix(vec3(l), color, uSaturation);
            color = clamp((color - 0.5) * uContrast + 0.5, 0.0, 1.0);

            // Split tone: shadows one way, highlights the other. Separating the
            // two ends of the range is most of what makes a graded frame look
            // like it was shot rather than rendered.
            color *= mix(uShadowTint, uHighTint, smoothstep(0.0, 0.85, l));

            // Lifted blacks. Film never reaches zero — the shadows sit on a
            // faint colour floor, and that floor is where the green in a cine
            // stock is most obvious.
            color += uLift * (1.0 - smoothstep(0.0, 0.55, l));

            color *= 1.0 - uVignette * smoothstep(0.22, 0.78, r);

            // Grain, held back in the highlights where real film has least of it.
            float n = hash(vUv * 2048.0 + fract(uTime) * 91.7);
            color += (n - 0.5) * uGrain * (1.0 - l * 0.7);

            color = clamp(color, 0.0, 1.0);
            gl_FragColor = vec4(
                mix(color * 12.92,
                    1.055 * pow(color, vec3(0.41666)) - 0.055,
                    step(vec3(0.0031308), color)),
                1.0
            );
        }
    `
};

let composer = null;
let gradePass = null;
try {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    gradePass = new ShaderPass(GradeShader);
    // The two multi-tap effects are the only part with a real per-pixel cost.
    // iOS runs the grade maths alone: one texture fetch, no extra bandwidth.
    if (!isIOS) gradePass.material.defines = { USE_GLARE: '', USE_ABERRATION: '' };
    composer.addPass(gradePass);

    // The pass tone maps and encodes to sRGB itself. Leaving the renderer's own
    // tone mapping on as well would apply the curve twice on the iOS fallback
    // path below and crush every highlight.
    renderer.toneMapping = THREE.NoToneMapping;
} catch (e) {
    // A half-float render target is the one thing here that can fail outright on
    // an old GPU. Falling back to the renderer's own tone mapping loses the
    // grade but keeps the game playable.
    console.warn('Post-processing unavailable, falling back to direct render.', e);
    composer = null;
    gradePass = null;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
}

// Pushes a look's grade block into the shader. Scalars and vec3s are described
// the same way in the LOOKS table, so this walks the uniforms rather than
// listing them twice.
const GRADE_KEYS = {
    exposure: 'uExposure', contrast: 'uContrast', saturation: 'uSaturation',
    whiteBalance: 'uWhiteBalance', shadowTint: 'uShadowTint', highTint: 'uHighTint',
    lift: 'uLift', vignette: 'uVignette', grain: 'uGrain', glare: 'uGlare',
    aberration: 'uAberration'
};
function applyGrade(grade) {
    if (!gradePass) return;
    for (const key in GRADE_KEYS) {
        const v = grade[key];
        if (v === undefined) continue;
        const u = gradePass.uniforms[GRADE_KEYS[key]];
        if (Array.isArray(v)) u.value.set(v[0], v[1], v[2]);
        else u.value = v;
    }
}

// --- DRACO LOADER SETUP (For your compressed Archway map) ---
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
// Note: We will attach this to the main loader below

// --- KTX2 LOADER SETUP ---
// The city ships as KTX2/ETC1S. Unlike PNG/JPEG/WebP — which all decode to
// RGBA8 at 5.3 bytes/texel once uploaded — these stay compressed on the GPU at
// roughly 0.67 bytes/texel, transcoded to ASTC on iOS and BC7/DXT on desktop.
// That is what lets the map run at its authored resolution instead of the 128px
// cap that turned buildings into flat colour.
const ktx2Loader = new KTX2Loader();
ktx2Loader.setTranscoderPath('https://unpkg.com/three@0.160.0/examples/jsm/libs/basis/');
ktx2Loader.detectSupport(renderer);

// --- 3. LOOK: LIGHTING, SKY AND GRADE ---------------------------------------
// Everything that defines a time of day lives in one table, because these
// values only work as a set: the sky, the tint multiplied into the unlit city,
// the fog, the lamps and the film grade all have to agree or it reads as a
// filter laid over a daylight photo.
//
// The city is unlit MeshBasicMaterial, so no light in this scene touches it —
// the ONLY way to take the photogrammetry to night is `cityTint`, which is
// multiplied straight into its albedo. That is also the cheapest possible way:
// no shader work, no extra pass, one colour per material.
//
// Live-tune any of this from the console with mqLook({ exposure: 1.4 }) and
// print the current numbers with mqLookDump() — see the bottom of this block.
const LOOKS = {
    night: {
        sky: 'night',
        // Not black. A city at night is lit by its own sodium and LED spill,
        // and the sky sits nearer blue-hour than midnight — that keeps the
        // photogrammetry readable instead of a grey smear.
        cityTint: 0x7c8aa4,
        fog: 0x121b28, fogNear: 300, fogFar: 2000, mapFogNear: 240, mapFogFar: 1400,
        key:     { color: 0xaac4ff, intensity: 1.5 },    // moonlight
        fill:    { color: 0xff9b52, intensity: 0.75 },   // sodium bounce off the street
        hemi:    { sky: 0x2b3b58, ground: 0x191410, intensity: 0.55 },
        ambient: { color: 0x33425e, intensity: 0.30 },
        // Moon direction, matched to where the moon is drawn in the sky texture.
        keyDir: new THREE.Vector3(0.465, 0.77, 0.437),
        grade: {
            exposure: 1.45, contrast: 1.10, saturation: 1.00,
            // Pull green through the whole frame and hold red/blue back. This is
            // what kills the magenta cast in the source photogrammetry, and it
            // does it before tone mapping, where it behaves like a filter on the
            // lens rather than a tint painted over the result.
            whiteBalance: [0.945, 1.030, 0.980],
            shadowTint:   [0.82, 1.00, 0.93],   // green-teal shadows
            highTint:     [1.06, 1.01, 0.88],   // warm street-lamp highlights
            lift:         [0.010, 0.022, 0.016], // faded green blacks
            vignette: 0.44, grain: 0.045, glare: 0.30
        }
    },
    day: {
        sky: 'texture',
        cityTint: 0xffffff,
        fog: 0xb9c9d8, fogNear: 320, fogFar: 2300, mapFogNear: 260, mapFogFar: 1500,
        key:     { color: 0xfff0d6, intensity: 2.6 },
        fill:    { color: 0xffd9b0, intensity: 0.0 },
        hemi:    { sky: 0xbcd6ff, ground: 0x5a5348, intensity: 0.55 },
        ambient: { color: 0xdfe9ff, intensity: 0.10 },
        keyDir: new THREE.Vector3(120, 130, 70).normalize(),
        grade: {
            exposure: 1.06, contrast: 1.14, saturation: 1.08,
            whiteBalance: [0.965, 1.020, 0.995],
            shadowTint:   [0.88, 1.00, 0.96],
            highTint:     [1.05, 1.01, 0.92],
            lift:         [0.004, 0.010, 0.007],
            vignette: 0.38, grain: 0.030, glare: 0.22
        }
    }
};

let currentLook = LOOKS.night;

// These only light characters, pickups, cars and police. Values are set by
// applyLook below; the constructor arguments are just placeholders.
const hemiLight = new THREE.HemisphereLight(0xbcd6ff, 0x5a5348, 0.55);
scene.add(hemiLight);

const ambientLight = new THREE.AmbientLight(0xdfe9ff, 0.10);
scene.add(ambientLight);

// Key. A low side light models form across a face; the old rig fired straight
// down from (50, 200, 50), which puts one flat value on everything facing up
// and is exactly what made characters look pasted-on.
const dirLight = new THREE.DirectionalLight(0xfff0d6, 2.6);
dirLight.position.set(120, 130, 70);
dirLight.castShadow = renderer.shadowMap.enabled;
dirLight.shadow.mapSize.width = isIOS ? 512 : 1024;
dirLight.shadow.mapSize.height = isIOS ? 512 : 1024;
dirLight.shadow.bias = -0.0002;
dirLight.shadow.normalBias = 0.03;
// The old frustum was ±300 around the world origin and never moved, so once the
// player rode away from spawn they were outside it and cast nothing at all.
// It now follows the player (see updateSunRig), which lets it be small: ±70 at
// 1024px is 0.14 world units per texel instead of 0.59, and the tighter frustum
// culls most of the city out of the shadow pass, so it also renders faster.
dirLight.shadow.camera.left = -70;
dirLight.shadow.camera.right = 70;
dirLight.shadow.camera.top = 70;
dirLight.shadow.camera.bottom = -70;
dirLight.shadow.camera.near = 1;
dirLight.shadow.camera.far = 420;
scene.add(dirLight);
scene.add(dirLight.target);

// Second, dimmer lamp from the opposite low angle. At night this is the sodium
// spill coming back up off the street, which is what stops the shadow side of
// the knight going to flat black — the single most useful light in a night rig
// after the key itself.
const fillLight = new THREE.DirectionalLight(0xff9b52, 0.0);
scene.add(fillLight);
scene.add(fillLight.target);

// Key offset from the player. Rebuilt by applyLook when the direction changes.
let SUN_OFFSET = dirLight.position.clone().normalize().multiplyScalar(220);
let FILL_OFFSET = new THREE.Vector3();

// Keeps the shadow frustum centred on the player. Cheap: a few vector copies
// and two matrix updates per frame.
function updateSunRig(focus) {
    if (!focus) return;
    dirLight.target.position.copy(focus);
    dirLight.position.copy(focus).add(SUN_OFFSET);
    dirLight.target.updateMatrixWorld();

    fillLight.target.position.copy(focus);
    fillLight.position.copy(focus).add(FILL_OFFSET);
    fillLight.target.updateMatrixWorld();
}

// --- SKY ---------------------------------------------------------------------
// Drawn rather than downloaded. A night photograph of a sky is mostly noise and
// compresses badly, and a painted one can be built to agree exactly with the
// lighting rig: the moon below sits where dirLight actually shines from, and
// the warm band along the horizon is the same sodium colour as the fill light.
// 2048x1024 is ~2MB of GPU memory after mipping, against the 92MB the city
// already costs, and it needs no network round trip.
function makeNightSkyTexture() {
    const W = 2048, H = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Equirectangular: row 0 is the zenith, row H/2 the horizon, row H the nadir.
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0.00, '#04060e');
    sky.addColorStop(0.28, '#0a1020');
    sky.addColorStop(0.44, '#152238');
    sky.addColorStop(0.50, '#25344a');   // horizon haze
    sky.addColorStop(0.56, '#141c28');
    sky.addColorStop(1.00, '#05070b');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // City light pollution: a warm band hugging the horizon, brightest where
    // the streets are densest. Uneven on purpose — a perfectly even band reads
    // as a gradient, not as a city.
    for (let i = 0; i < 5; i++) {
        const cx = (i / 5 + 0.07) * W + Math.sin(i * 2.3) * 180;
        const R = W * 0.16;
        const glow = ctx.createRadialGradient(cx, H * 0.5, 0, cx, H * 0.5, R);
        glow.addColorStop(0, 'rgba(255, 150, 70, 0.30)');
        glow.addColorStop(0.5, 'rgba(255, 130, 60, 0.10)');
        glow.addColorStop(1, 'rgba(255, 120, 50, 0)');
        ctx.fillStyle = glow;
        // Fill the gradient's whole bounding box. Clipping it to a shorter strip
        // cuts the falloff off mid-ramp and leaves a hard line across the sky.
        ctx.fillRect(cx - R, H * 0.5 - R, R * 2, R * 2);
    }

    // Stars, thinning out toward the horizon where the haze swallows them.
    // Deterministic so the sky is identical every run.
    let seed = 20260803;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 1400; i++) {
        const x = rand() * W;
        const y = rand() * H * 0.5;
        const alt = 1 - (y / (H * 0.5));           // 1 at zenith, 0 at horizon
        const a = (0.25 + rand() * 0.75) * (0.15 + alt * 0.85);
        const r = 0.4 + rand() * (0.6 + alt * 0.5);
        // A few stars run warm, most run cold — otherwise the field looks printed.
        ctx.fillStyle = rand() > 0.85
            ? `rgba(255, 226, 190, ${a})`
            : `rgba(214, 230, 255, ${a})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }

    // The moon, at the equirect coordinates matching LOOKS.night.keyDir:
    //   u = atan2(z, x) / 2pi + 0.5,  v = asin(y) / pi + 0.5, canvas row = (1 - v) * H
    const d = LOOKS.night.keyDir;
    const mx = ((Math.atan2(d.z, d.x) / (Math.PI * 2)) + 0.5) * W;
    const my = (1 - (Math.asin(d.y) / Math.PI + 0.5)) * H;
    const halo = ctx.createRadialGradient(mx, my, 0, mx, my, 190);
    halo.addColorStop(0.00, 'rgba(210, 226, 255, 0.55)');
    halo.addColorStop(0.18, 'rgba(180, 200, 245, 0.16)');
    halo.addColorStop(1.00, 'rgba(150, 175, 230, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(mx, my, 190, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f2f6ff';
    ctx.beginPath(); ctx.arc(mx, my, 21, 0, Math.PI * 2); ctx.fill();

    const tex = new THREE.CanvasTexture(canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

// Materials taken off the city GLB, kept so the tint can be re-applied when the
// look changes without reloading 92MB.
const cityMaterials = [];
function applyCityTint() {
    const tint = new THREE.Color(currentLook.cityTint);
    for (const m of cityMaterials) {
        if (!m || !m.color) continue;
        // baseColor is what the GLB shipped; tint always multiplies that, so
        // switching looks repeatedly never compounds.
        m.color.copy(m.userData.baseColor || tint).multiply(tint);
    }
}

let skyTexture = null;
function applySky() {
    if (skyTexture) { skyTexture.dispose(); skyTexture = null; }
    if (scene.environment) { scene.environment.dispose(); scene.environment = null; }

    const finish = (texture) => {
        skyTexture = texture;
        const pmrem = new THREE.PMREMGenerator(renderer);
        // The sky stays sharp as the background; its prefiltered version becomes
        // the scene's image-based light, so armour, car paint and the bike
        // reflect an actual sky instead of being lit by lamps in a void.
        scene.background = texture;
        scene.environment = pmrem.fromEquirectangular(texture).texture;
        pmrem.dispose();
    };

    if (currentLook.sky === 'night') {
        finish(makeNightSkyTexture());
    } else {
        new THREE.TextureLoader().load('textures/sky.jpg', (texture) => {
            texture.mapping = THREE.EquirectangularReflectionMapping;
            texture.colorSpace = THREE.SRGBColorSpace;
            finish(texture);
        });
    }
}

function applyLook(name) {
    if (LOOKS[name]) currentLook = LOOKS[name];
    const L = currentLook;

    hemiLight.color.set(L.hemi.sky);
    hemiLight.groundColor.set(L.hemi.ground);
    hemiLight.intensity = L.hemi.intensity;

    ambientLight.color.set(L.ambient.color);
    ambientLight.intensity = L.ambient.intensity;

    dirLight.color.set(L.key.color);
    dirLight.intensity = L.key.intensity;
    SUN_OFFSET = L.keyDir.clone().normalize().multiplyScalar(220);

    fillLight.color.set(L.fill.color);
    fillLight.intensity = L.fill.intensity;
    // Opposite side, lower down — a bounce, not a second key.
    FILL_OFFSET.set(-L.keyDir.x, Math.abs(L.keyDir.y) * 0.35, -L.keyDir.z)
        .normalize().multiplyScalar(200);

    if (!scene.fog) scene.fog = new THREE.Fog(L.fog, L.fogNear, L.fogFar);
    scene.fog.color.set(L.fog);

    applySky();
    applyCityTint();
    if (gradePass) applyGrade(L.grade);
}

// --- ENVIRONMENT ---
function initEnvironment() {
    // Aerial perspective. Distance haze is the strongest depth cue a flat
    // photogrammetry city can be given, and on fogged materials it is free —
    // it is already in every shader. The old fog was near-black navy starting
    // at 1500 units, i.e. invisible during play and, where it did land, it
    // darkened distance instead of lifting it the way real atmosphere does.
    scene.fog = new THREE.Fog(currentLook.fog, currentLook.fogNear, currentLook.fogFar);

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
applyLook('night');

// Live look controls, for dialling this in against the real map rather than
// against a guess. In the browser console:
//   mqLook({ exposure: 1.6, saturation: 0.9 })   tweak the grade
//   mqLook('day') / mqLook('night')              switch time of day
//   mqLookDump()                                 print the current numbers
window.mqLook = (arg) => {
    if (typeof arg === 'string') { applyLook(arg); return arg; }
    Object.assign(currentLook.grade, arg || {});
    applyGrade(currentLook.grade);
    return currentLook.grade;
};
window.mqLookDump = () => JSON.stringify(currentLook.grade, null, 2);
window.mqScene = scene;   // console handle, and how the sky gets inspected

// Swap maps without editing the source, for A/B-ing a re-exported city against
// the one in use: mqLoadMap('shoreditch-flat.glb')
window.mqLoadMap = (name) => { currentMapName = name; loadLevel(name); return name; };

// --- CONTACT SHADOWS ---------------------------------------------------------
// The city is MeshBasicMaterial, and a basic material cannot receive a shadow —
// so no matter how good the shadow map gets, nothing the player, the police or
// the traffic casts will ever land on the street. That is why everything looked
// pasted on top of the photo rather than standing in it.
//
// A soft dark ellipse under each object fixes exactly that, and it is the same
// trick shipped games used for years before shadow maps were affordable. Cost
// is one 128px texture and a pool of quads that never grows.
const CONTACT_SHADOW_POOL = 18;
const contactShadows = [];
let contactShadowGroup = null;

function makeContactShadowTexture() {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    // Not a linear ramp — real contact shadow falls off fast at the edge and is
    // densest right under the object.
    g.addColorStop(0.00, 'rgba(0,0,0,0.85)');
    g.addColorStop(0.45, 'rgba(0,0,0,0.42)');
    g.addColorStop(0.78, 'rgba(0,0,0,0.10)');
    g.addColorStop(1.00, 'rgba(0,0,0,0.00)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

function initContactShadows() {
    contactShadowGroup = new THREE.Group();
    const tex = makeContactShadowTexture();
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < CONTACT_SHADOW_POOL; i++) {
        const mat = new THREE.MeshBasicMaterial({
            map: tex,
            transparent: true,
            depthWrite: false,     // never occludes anything behind it
            fog: false,            // it is a contact, not an object in the haze
            opacity: 0
        });
        const quad = new THREE.Mesh(geo, mat);
        quad.rotation.x = -Math.PI / 2;
        quad.renderOrder = 2;
        quad.visible = false;
        quad.frustumCulled = false;
        contactShadowGroup.add(quad);
        contactShadows.push(quad);
    }
    scene.add(contactShadowGroup);
}
initContactShadows();

// Last Y the player was actually standing on, so a jump lifts and fades the
// shadow instead of dragging it up into the air with them.
let playerGroundY = 0;

const _shadowTargets = [];
function addShadowTarget(x, y, z, sx, sz, alpha, rot) {
    _shadowTargets.push({ x, y, z, sx, sz, alpha, rot: rot || 0 });
}

function updateContactShadows() {
    if (!contactShadows.length) return;
    _shadowTargets.length = 0;

    if (playerGroup) {
        const air = Math.max(0, playerGroup.position.y - playerGroundY);
        // Airborne: the penumbra spreads and thins, the way it does when you
        // lift an object off a surface. Past ~26 units up there is nothing left.
        const spread = 1 + air * 0.035;
        const s = (hasBike ? 4.0 : 2.8) * spread;
        addShadowTarget(
            playerGroup.position.x, playerGroundY, playerGroup.position.z,
            s, hasBike ? s * 1.5 : s,
            0.8 * Math.max(0, 1 - air / 26),
            playerGroup.rotation.y
        );
    }

    for (const e of activeEnemies) {
        const o = e.mesh || e.groupRef;
        if (!o) continue;
        addShadowTarget(o.position.x, o.position.y, o.position.z, 3.0, 3.0, 0.65, 0);
    }

    // A car's mesh sits `lift` above the road surface (the two GLBs disagree on
    // where their origin is), so subtract it to land back on the tarmac. The
    // ellipse is stretched down the length of the car and yawed with it — a
    // circle under a car reads as a puddle.
    for (const car of cars) {
        const o = car.mesh;
        if (!o) continue;
        addShadowTarget(
            o.position.x, o.position.y - (car.lift || 0), o.position.z,
            4.6, CAR_LENGTH * 1.15, 0.5, o.rotation.y
        );
    }

    for (let i = 0; i < contactShadows.length; i++) {
        const quad = contactShadows[i];
        const t = _shadowTargets[i];
        if (!t || t.alpha <= 0.01) { quad.visible = false; continue; }
        quad.visible = true;
        // 0.06 above the surface: enough to clear z-fighting on photogrammetry
        // road geometry, small enough to still read as contact.
        quad.position.set(t.x, t.y + 0.06, t.z);
        quad.scale.set(t.sx, t.sz, 1);
        // The quad is laid flat by rotation.x, so its own Z is the world's up
        // axis and yaw has to be applied there.
        quad.rotation.z = -t.rot;
        quad.material.opacity = t.alpha;
    }
}

// --- 4. ASSETS ---
const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);
loader.setKTX2Loader(ktx2Loader);

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

// --- NAVIGATION: ENERGY TRAIL ---
// A ribbon laid along the road route with pulses of light running down it toward
// the drop-off. Replaces the floating cone and the dashed Line2 route: one
// element now does both jobs, and it reads as something to follow rather than
// something to interpret.

const TRAIL_MAX_POINTS = 512;                 // spine samples; ribbon is 2 verts each
const TRAIL_WIDTH_GAME = 1.7;                 // half-width in world units, chase cam
const TRAIL_WIDTH_MAP  = 7.0;                 // wider so it still reads from 200 units up
const TRAIL_LIFT       = 0.45;                // above the road surface

const trailGeo = new THREE.BufferGeometry();
const trailPositions = new Float32Array(TRAIL_MAX_POINTS * 2 * 3);
const trailUVs       = new Float32Array(TRAIL_MAX_POINTS * 2 * 2);
const trailIndices   = new Uint16Array((TRAIL_MAX_POINTS - 1) * 6);
for (let i = 0; i < TRAIL_MAX_POINTS - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    trailIndices.set([a, b, c, b, d, c], i * 6);
}
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
trailGeo.setAttribute('uv', new THREE.BufferAttribute(trailUVs, 2));
trailGeo.setIndex(new THREE.BufferAttribute(trailIndices, 1));
trailGeo.setDrawRange(0, 0);

// uv.x carries distance along the route in world units (so pulse spacing and
// speed stay constant regardless of how the path was sampled); uv.y is 0..1
// across the ribbon's width.
const trailMat = new THREE.ShaderMaterial({
    uniforms: {
        uTime:        { value: 0 },
        uTotalLength: { value: 1 },
        uColorCore:   { value: new THREE.Color(0xdffbff) }, // hot centre
        uColorEdge:   { value: new THREE.Color(0x18b6ff) }, // electric blue body
        uOpacity:     { value: 1.0 }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform float uTime;
        uniform float uTotalLength;
        uniform vec3  uColorCore;
        uniform vec3  uColorEdge;
        uniform float uOpacity;
        varying vec2  vUv;

        void main() {
            float across = abs(vUv.y * 2.0 - 1.0);        // 0 at centre, 1 at the edges
            float edge   = 1.0 - smoothstep(0.30, 1.0, across);
            float core   = 1.0 - smoothstep(0.0, 0.42, across);

            float d = vUv.x;

            // Pulses travelling toward the destination: a sharp head with a tail
            // trailing behind it, repeating every ~20 units.
            float wave  = fract(d * 0.05 - uTime * 0.7);
            float pulse = pow(wave, 5.0);

            // Always-on base glow so the whole route stays readable between pulses.
            float intensity = (0.30 + pulse * 0.95) * edge + core * 0.35;

            // Don't blast the camera at the player's feet, and taper into the beacon.
            float fadeIn  = smoothstep(0.0, 14.0, d);
            float fadeOut = 1.0 - smoothstep(uTotalLength - 22.0, uTotalLength, d);

            vec3 col = mix(uColorEdge, uColorCore, clamp(core * 0.75 + pulse * 0.6, 0.0, 1.0));
            float a  = intensity * fadeIn * fadeOut * uOpacity;

            gl_FragColor = vec4(col, a);
        }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,      // buildings still occlude it
    side: THREE.DoubleSide,
    toneMapped: false
});

const navTrail = new THREE.Mesh(trailGeo, trailMat);
navTrail.frustumCulled = false;   // spine is rebuilt in place; bounds would be stale
navTrail.renderOrder = -3;
navTrail.visible = false;
scene.add(navTrail);

// Diagnostics. pathPoints === 0 means A* found no road route and the trail is
// running straight at the beacon through whatever is in the way — that's a
// pathfinding problem, not a rendering one, and the two look identical in game.
window.mqTrailInfo = () => ({
    visible: navTrail.visible,
    verts: trailGeo.drawRange.count,
    length: +trailMat.uniforms.uTotalLength.value.toFixed(1),
    pathPoints: currentNavPath.length,
    navGrid: navGrid ? 'built' : 'missing'
});

const TRAIL_UP = new THREE.Vector3(0, 1, 0);
const _tanA = new THREE.Vector3(), _tanB = new THREE.Vector3(), _side = new THREE.Vector3();

// Rebuilds the ribbon from a polyline. Buffers are preallocated and rewritten in
// place — this runs several times a second and must not churn the GC.
function buildTrail(points, halfWidth) {
    const n = Math.min(points.length, TRAIL_MAX_POINTS);
    if (n < 2) { navTrail.visible = false; return; }

    let dist = 0;
    for (let i = 0; i < n; i++) {
        const p = points[i];

        // Tangent from neighbours so joints stay smooth around corners.
        if (i > 0) {
            dist += _tanA.subVectors(p, points[i - 1]).length();
            _tanA.normalize();
        }
        if (i < n - 1) _tanB.subVectors(points[i + 1], p).normalize();
        const tangent = (i === 0) ? _tanB : (i === n - 1 ? _tanA : _tanA.clone().add(_tanB).normalize());

        _side.crossVectors(TRAIL_UP, tangent);
        if (_side.lengthSq() < 1e-6) _side.set(1, 0, 0);   // path pointing straight up
        _side.normalize().multiplyScalar(halfWidth);

        const v = i * 6;
        trailPositions[v    ] = p.x - _side.x;
        trailPositions[v + 1] = p.y - _side.y;
        trailPositions[v + 2] = p.z - _side.z;
        trailPositions[v + 3] = p.x + _side.x;
        trailPositions[v + 4] = p.y + _side.y;
        trailPositions[v + 5] = p.z + _side.z;

        const t = i * 4;
        trailUVs[t    ] = dist; trailUVs[t + 1] = 0;
        trailUVs[t + 2] = dist; trailUVs[t + 3] = 1;
    }

    trailGeo.attributes.position.needsUpdate = true;
    trailGeo.attributes.uv.needsUpdate = true;
    trailGeo.setDrawRange(0, (n - 1) * 6);
    trailMat.uniforms.uTotalLength.value = Math.max(dist, 1);
}

// Swaps a city tile's lit material for an unlit one carrying the same texture.
// Disposes the old material but NOT its textures — those are handed straight to
// the replacement.
function toUnlitCityMaterial(src) {
    const mats = Array.isArray(src) ? src : [src];
    const out = mats.map(m => {
        if (!m || m.isMeshBasicMaterial) return m;
        const basic = new THREE.MeshBasicMaterial({
            map: m.map || null,
            color: m.color ? m.color.clone() : undefined,
            vertexColors: m.vertexColors,
            transparent: m.transparent,
            opacity: m.opacity,
            alphaTest: m.alphaTest,
            side: THREE.DoubleSide,   // photogrammetry has inconsistent winding
            fog: true
        });
        // Remembering what the GLB shipped is what lets the time of day be
        // switched over and over without the tint compounding into mud.
        basic.userData.baseColor = basic.color.clone();
        basic.color.multiply(new THREE.Color(currentLook.cityTint));
        cityMaterials.push(basic);
        m.dispose();
        return basic;
    });
    return Array.isArray(src) ? out : out[0];
}

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
    cityMaterials.length = 0;   // these were just disposed with the old map
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

    // Traffic is routed against the old nav grid, so it can't survive a map swap.
    cars.forEach(c => scene.remove(c.mesh));
    cars = [];

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
                    // Used by the nav grid to sample street height. Kept apart
                    // from colliderMeshes because that also holds the Border
                    // box, whose lid spans the whole map and would return a
                    // height of ~366 for every cell.
                    groundMeshes.push(child);
                    if (child.material) {
                        // Photogrammetry already has sunlight and shadow baked
                        // into its textures, so lighting it again is wrong: the
                        // 4.0 units of flat ambient/hemisphere fill in every
                        // baked shadow. The source tiles average 29% grey and
                        // were rendering near-white. Unlit restores the contrast
                        // that is already in the data, and skips lighting maths
                        // across 1.8M triangles.
                        child.material = toUnlitCityMaterial(child.material);
                        // Downsample any uncompressed tile before it reaches the
                        // GPU. KTX2 tiles are skipped — they are already small.
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

        // Seed traffic. Needs buildNavGrid() above it — cars route on the same
        // road graph the navigation trail uses.
        for (let i = 0; i < MAX_CARS; i++) spawnCar();

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

// --- PLAYER (KNIGHT) + NPC (OLD PLAYER MODEL) ---
//
// The knight is the player; playermodel.glb is now only the civilian crowd.
//
// Both are Mixamo rigs, but Sketchfab's exporter suffixed every knight bone with
// an index ("mixamorig:Spine" -> "mixamorig:Spine_13"), so the knight's own file
// only carries an Idle clip and playermodel's clips don't bind to it as-is.
// 25 of the knight's 26 bones map onto playermodel's once that suffix is
// stripped — the 16 it lacks are finger bones, which none of these animations
// need — so the clips are retargeted here at load rather than in Blender.
let playerMesh;
let mixer;
let animationsMap = new Map();
let currentAction;

let npcTemplate = null;   // playermodel.glb, cloned for the roaming crowd
let npcClips = null;

// Do NOT try to derive this with Box3.setFromObject(). On a skinned mesh that
// reads bind-space geometry and ignores the bone transforms that actually size
// the character — for this knight it reports 0.0136 against a true height of
// 1.76, which scales him to roughly 500 units tall.
//
// The reliable measure is the bind-pose skeleton, recovered from the inverse
// bind matrices:
//     ps1_psx_knight  1.7623 tall
//     playermodel     1.9647 tall, rendered at scale 2.0 -> 3.93 units
// so 3.93 / 1.7623 gives the knight the same on-screen height as the old player.
const PLAYER_SCALE = 2.23;

// Normalises a bone name so the same joint matches across our sources:
//  - Sketchfab's FBX->glTF conversion appends an index ("Spine2" -> "Spine2_11")
//  - three.js sanitises node names on import and strips ":" and "." characters,
//    so "mixamorig:Spine2" arrives as "mixamorigSpine2"
// After this, "mixamorig:Spine2", "mixamorigSpine2" and "mixamorigSpine2_11"
// all collapse to the same key.
const baseBoneName = (n) => (n || '')
    .replace(/_\d+$/, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();

/**
 * Rebinds clips authored for one skeleton onto another whose bones carry the
 * same names modulo that numeric suffix. Tracks targeting bones the destination
 * doesn't have are dropped, which is what keeps the finger curves from spamming
 * "no target node found" warnings every frame.
 */
function retargetClips(clips, targetRoot) {
    const byBaseName = new Map();
    targetRoot.traverse(o => {
        const base = baseBoneName(o.name);
        if (o.name && !byBaseName.has(base)) byBaseName.set(base, o.name);
    });

    return clips.map(clip => {
        const tracks = [];
        let dropped = 0;
        for (const track of clip.tracks) {
            const dot = track.name.lastIndexOf('.');
            if (dot < 0) continue;
            const nodeName = track.name.slice(0, dot);
            const property = track.name.slice(dot);

            const mapped = byBaseName.get(baseBoneName(nodeName));
            if (!mapped) { dropped++; continue; }

            const t = track.clone();
            t.name = mapped + property;
            tracks.push(t);
        }
        if (dropped) console.log(`retarget "${clip.name}": dropped ${dropped} track(s) with no matching bone`);
        return new THREE.AnimationClip(clip.name, clip.duration, tracks);
    });
}

// The knight and the clips it needs arrive in separate files, in either order.
let pendingKnight = null;
function tryBuildPlayer() {
    if (!pendingKnight || !npcClips) return;

    playerMesh = pendingKnight;
    pendingKnight = null;

    playerMesh.scale.setScalar(PLAYER_SCALE);
    playerMesh.rotation.y = Math.PI;

    playerGroup.add(playerMesh);

    mixer = new THREE.AnimationMixer(playerMesh);
    for (const clip of retargetClips(npcClips, playerMesh)) {
        // 'Jumping' is a duplicate of 'Jump' in playermodel.glb; ignore it.
        if (['Idle', 'Run', 'Jump', 'Punch'].includes(clip.name)) {
            animationsMap.set(clip.name, mixer.clipAction(clip));
        }
    }

    currentAction = animationsMap.get('Idle');
    if (currentAction) currentAction.play();

    console.log('Player animations:', [...animationsMap.keys()].join(', '));

    tryBuildBikeRider();   // the bike may already be loaded
}

// Retargeting fails silently — the model just stands frozen in bind pose. Sample
// a bone twice and compare: if the quaternion never changes, the tracks aren't
// binding to the skeleton.
window.mqPlayerInfo = () => {
    if (!playerMesh) return { ready: false };
    const bone = findBone(playerMesh, 'mixamorig:LeftForeArm');
    return {
        ready: true,
        scale: +playerMesh.scale.x.toFixed(3),
        boneName: bone ? bone.name : null,
        clips: [...animationsMap.keys()],
        current: currentAction ? currentAction.getClip().name : null,
        running: currentAction ? currentAction.isRunning() : false,
        boneQ: bone ? bone.quaternion.toArray().map(v => +v.toFixed(4)) : null,
        npcs: roamingNPCs.length,
        teeAttached: !!wornTeeInstance,
        teeVisible: wornTeeInstance ? wornTeeInstance.visible : false
    };
};
// Test hook: armour normally only changes by collecting a pickup.
window.mqDebugArmor = (n) => { armor = n; };

window.mqCombatInfo = () => ({
    playerHealth,
    maxHealth: PLAYER_MAX_HEALTH,
    armor,
    gameActive,
    isBusted,
    punchCooldown: +playerPunchTimer.toFixed(2),
    npcs: roamingNPCs.map(n => ({
        state: n.state,
        health: n.health,
        dist: +n.mesh.position.distanceTo(playerGroup.position).toFixed(1),
        swinging: n.windup >= 0
    }))
});

// Test hook: drops an NPC in the player's face so a brawl can be exercised
// without walking one down first.
window.mqDebugPickFight = () => {
    const npc = roamingNPCs[0];
    if (!npc) return false;
    // In front of the player, not beside him — the punch arc is a cone around
    // the camera's facing, so a target off to the side is unhittable by design.
    const facing = new THREE.Vector3(Math.sin(cameraAngle), 0, Math.cos(cameraAngle));
    npc.mesh.position.copy(playerGroup.position).addScaledVector(facing, 3.0);
    npc.state = 'CHASE';
    return true;
};

// Reports where the tee actually ends up. Box3.setFromObject is useless on a
// SkinnedMesh — it reads bind-space geometry and ignores the bones — so this
// walks real vertices through getVertexPosition(), which does apply them.
window.mqTeeInfo = () => {
    if (!playerMesh) return { ready: false };

    const measure = (root) => {
        const box = new THREE.Box3();
        const v = new THREE.Vector3();
        let sampled = 0;
        root.traverse(o => {
            if (!o.isMesh || !o.geometry?.attributes?.position) return;
            const n = o.geometry.attributes.position.count;
            const step = Math.max(1, Math.ceil(n / 400));   // sample; some of these are dense
            for (let i = 0; i < n; i += step) {
                o.getVertexPosition(i, v);
                box.expandByPoint(o.localToWorld(v));
                sampled++;
            }
        });
        if (sampled === 0) return null;
        const r = (p) => [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)];
        return { min: r(box.min), max: r(box.max), sampled };
    };

    let playerSkin = null;
    playerMesh.traverse(o => { if (!playerSkin && o.isSkinnedMesh) playerSkin = o; });

    return {
        ready: true,
        templateLoaded: !!wornTeeTemplate,
        templateSkinned: wornTeeTemplate
            ? (() => { let s = false; wornTeeTemplate.traverse(o => { if (o.isSkinnedMesh) s = true; }); return s; })()
            : null,
        attached: !!wornTeeInstance,
        visible: wornTeeInstance ? wornTeeInstance.visible : false,
        armor,
        tee: wornTeeInstance ? measure(wornTeeInstance) : null,
        player: playerSkin ? measure(playerSkin) : null
    };
};

loader.load('ps1_psx_knight.glb', (gltf) => {
    pendingKnight = optimizeModel(gltf.scene, { cap: TEX_CAP_CHAR });
    pendingKnight.traverse(o => {
        if (o.isMesh && o.material) {
            o.material.metalness = 0.0;
            o.material.roughness = 0.9;
        }
    });
    tryBuildPlayer();
}, undefined, (err) => console.error("Knight Model Error:", err));

// --- WEARABLE T-SHIRT ---
//
// The CLO3D garment is a static mesh with no skin weights, so it can't deform
// with the knight. Instead it's parented to the chest bone: it inherits that
// bone's motion, which for a boxy tee on a low-poly character reads fine and
// needs no Blender work. If you later skin the garment to the same Mixamo
// skeleton, drop that file in as liontee_worn.glb and it will be picked up
// automatically (see WORN_TEE_FILE below).
//
// Poly budget matters here: the raw garment is 1.4M triangles and the optimizer
// output is 208k, against a 544-triangle knight. For something worn every frame,
// decimate it to ~1-2k triangles with a 256px texture.
const WORN_TEE_FILE   = 'liontee_worn.glb';          // optional; falls back to the pickup model
const WORN_TEE_BONE   = 'mixamorig:Spine2';          // chest; matched ignoring the _NN suffix
const WORN_TEE_HEIGHT = 1.3;                         // world units, ~torso height on a 4-unit character
const WORN_TEE_OFFSET = new THREE.Vector3(0, 0, 0);  // world units, relative to the chest bone
const WORN_TEE_ROTATION = new THREE.Euler(0, 0, 0);

let wornTeeTemplate = null;  // null -> fall back to lionTeeTemplate
let wornTeeInstance = null;

loader.load(WORN_TEE_FILE, (gltf) => {
    wornTeeTemplate = optimizeModel(gltf.scene, { cap: TEX_CAP_CHAR, castShadow: false });
    console.log('Worn tee: using', WORN_TEE_FILE);
}, undefined, () => {
    // Absent by design — the pickup model is used instead.
    console.log(`Worn tee: ${WORN_TEE_FILE} not found, falling back to the pickup model`);
});

function findBone(root, name) {
    const want = baseBoneName(name);
    let found = null;
    root.traverse(o => {
        if (!found && baseBoneName(o.name) === want) found = o;
    });
    return found;
}

// --- KNIGHT ON THE BIKE ---
// playerbike.glb ships its own rider: a 40,000-triangle copy of the old player
// model skinned to the same 41 mixamorig bones, pedalling via the "crunches"
// clip. We hide that rider and drive a knight with the same clip instead.
//
// Only the ROTATION tracks are reused. The two rigs are authored at different
// unit scales (bike rider's bind skeleton spans 0.42, the knight's 1.76), so the
// clip's position tracks would throw the knight metres off the saddle. Bone
// rotations are scale-independent, which is what makes the pose transfer safely;
// placement is then measured at runtime rather than hard-coded.
let bikeRider = null;
let bikeRiderMixer = null;
let bikeAlignResidual = null;   // diagnostic, filled in by tryBuildBikeRider
let pendingBikeClips = null;

function tryBuildBikeRider() {
    if (bikeRider || !playerMesh || !playerBikeMesh || !pendingBikeClips) return;

    const crunches = THREE.AnimationClip.findByName(pendingBikeClips, 'crunches');
    if (!crunches) { console.warn('Bike: no "crunches" clip to drive the rider'); return; }

    // Anchor on the original rider's skeleton before hiding it. Capture the
    // bone references now: once the knight is parented under the bike, a
    // findBone() search would be as likely to return one of his.
    const riderHips = findBone(playerBikeMesh, 'mixamorig:Hips');
    const riderTop  = findBone(playerBikeMesh, 'mixamorig:HeadTop_End');
    const riderLSh  = findBone(playerBikeMesh, 'mixamorig:LeftShoulder');
    const riderRSh  = findBone(playerBikeMesh, 'mixamorig:RightShoulder');
    if (!riderHips || !riderTop || !riderLSh || !riderRSh) {
        console.warn('Bike: rider skeleton not found'); return;
    }

    playerBikeMesh.updateWorldMatrix(true, true);
    const riderHipsW = new THREE.Vector3().setFromMatrixPosition(riderHips.matrixWorld);
    const riderTopW  = new THREE.Vector3().setFromMatrixPosition(riderTop.matrixWorld);
    const riderSpan  = riderHipsW.distanceTo(riderTopW);

    // Hide the built-in rider — the mesh, not its skeleton, which still drives
    // the wheels and pedals through bikeMixer.
    playerBikeMesh.traverse(o => { if (o.isSkinnedMesh) o.visible = false; });

    bikeRider = SkeletonUtils.clone(playerMesh);
    bikeRider.position.set(0, 0, 0);
    bikeRider.rotation.set(0, 0, 0);
    bikeRider.scale.setScalar(1);
    playerBikeMesh.add(bikeRider);

    bikeRider.updateWorldMatrix(true, true);
    const kHips = findBone(bikeRider, 'mixamorig:Hips');
    const kTop  = findBone(bikeRider, 'mixamorig:HeadTop_End');
    if (!kHips || !kTop) { console.warn('Bike: knight skeleton not found'); return; }

    const kSpan = new THREE.Vector3().setFromMatrixPosition(kHips.matrixWorld)
        .distanceTo(new THREE.Vector3().setFromMatrixPosition(kTop.matrixWorld));
    const s = kSpan > 1e-6 ? riderSpan / kSpan : 1;
    bikeRider.scale.setScalar(s);

    const retargeted = retargetClips([crunches], bikeRider)[0];
    const rotationOnly = new THREE.AnimationClip(
        'bike-ride',
        retargeted.duration,
        retargeted.tracks.filter(t => t.name.endsWith('.quaternion'))
    );

    bikeRiderMixer = new THREE.AnimationMixer(bikeRider);
    bikeRiderMixer.clipAction(rotationOnly).play();

    // Orient the knight on the bike.
    //
    // "crunches" is a sit-up clip; what makes it read as pedalling is the bike
    // armature's own node rotation, which the knight — parented to the bike root
    // — does not inherit. Left uncorrected he lies on his back across the frame.
    //
    // Matching his Hips *bone* frame to the rider's does not fix it: the two rigs
    // came through different exporters and their joint rest orientations differ,
    // which lands him head-down instead. So match the *body*. Pose both skeletons
    // identically, then align spine-up and shoulder-across between them. That is
    // measured from where the bones actually are, so it does not care how either
    // rig chose to orient its joints.
    // Both skeletons have to be in the SAME pose for the comparison to mean
    // anything. The bike's own actions aren't started until the player picks one
    // up, so at this point its rider is still in bind pose — comparing a
    // crunching knight against a T-posed rider is what left him a quarter turn
    // out. Drive the rider with the same clip first, then put it back.
    const riderPose = bikeMixer ? bikeMixer.clipAction(crunches) : null;
    const riderWasRunning = riderPose ? riderPose.isRunning() : false;
    if (riderPose && !riderWasRunning) riderPose.reset().play();
    if (bikeMixer) bikeMixer.setTime(0);
    bikeRiderMixer.setTime(0);
    playerBikeMesh.updateWorldMatrix(true, true);

    const posOf = (o) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
    const bodyFrame = (hips, top, lsh, rsh) => {
        const up = posOf(top).sub(posOf(hips)).normalize();
        const across = posOf(rsh).sub(posOf(lsh));
        across.sub(up.clone().multiplyScalar(across.dot(up))).normalize();
        const fwd = new THREE.Vector3().crossVectors(across, up);
        return new THREE.Quaternion().setFromRotationMatrix(
            new THREE.Matrix4().makeBasis(across, up, fwd)
        );
    };

    const kLSh = findBone(bikeRider, 'mixamorig:LeftShoulder');
    const kRSh = findBone(bikeRider, 'mixamorig:RightShoulder');
    let alignedBy = null;
    if (kLSh && kRSh) {
        const qRider  = bodyFrame(riderHips, riderTop, riderLSh, riderRSh);
        const qKnight = bodyFrame(kHips, kTop, kLSh, kRSh);
        const delta = qRider.multiply(qKnight.invert());
        alignedBy = THREE.MathUtils.radToDeg(2 * Math.acos(Math.min(1, Math.abs(delta.w))));

        // delta is in world space; bikeRider's rotation is in the bike's.
        const bikeQ = new THREE.Quaternion();
        playerBikeMesh.matrixWorld.decompose(new THREE.Vector3(), bikeQ, new THREE.Vector3());
        bikeRider.quaternion.premultiply(bikeQ.clone().invert().multiply(delta).multiply(bikeQ));
    } else {
        console.warn('Bike: knight has no shoulder bones; leaving him unaligned');
    }

    // Nudge so the knight's hips land exactly where the rider's were. Must come
    // after the rotation, which moves them.
    bikeRider.updateWorldMatrix(true, true);
    bikeRider.position.add(
        playerBikeMesh.worldToLocal(posOf(riderHips))
            .sub(playerBikeMesh.worldToLocal(posOf(kHips)))
    );

    // Residual check, taken while both skeletons are still driven by the same
    // clip at the same time — the only moment the two are directly comparable.
    // (In play the bike's own actions pause when the player stops pedalling, so
    // a later comparison would measure animation phase, not orientation.)
    if (kLSh && kRSh) {
        bikeRider.updateWorldMatrix(true, true);
        const upR = posOf(riderTop).sub(posOf(riderHips)).normalize();
        const upK = posOf(kTop).sub(posOf(kHips)).normalize();
        const acR = posOf(riderRSh).sub(posOf(riderLSh)).normalize();
        const acK = posOf(kRSh).sub(posOf(kLSh)).normalize();
        bikeAlignResidual = {
            upDeg: +THREE.MathUtils.radToDeg(upR.angleTo(upK)).toFixed(1),
            acrossDeg: +THREE.MathUtils.radToDeg(acR.angleTo(acK)).toFixed(1)
        };
        console.log(`Bike rider: residual up ${bikeAlignResidual.upDeg}deg, across ${bikeAlignResidual.acrossDeg}deg`);
    }

    if (riderPose && !riderWasRunning) riderPose.stop();

    console.log(
        `Bike rider: knight scaled ${s.toFixed(3)} (rider span ${riderSpan.toFixed(3)} / ` +
        `knight ${kSpan.toFixed(3)}), ${rotationOnly.tracks.length} rotation tracks` +
        (alignedBy === null ? '' : `, aligned by ${alignedBy.toFixed(1)}deg`)
    );
}

// Shows/hides the tee to match armour state. Built lazily on first pickup so we
// don't pay for it in games where the player never finds one.
function updateWornTee() {
    const shouldWear = armor > 0;

    if (shouldWear && !wornTeeInstance && playerMesh) {
        const source = wornTeeTemplate || lionTeeTemplate;
        if (!source) return;   // neither loaded yet; try again next frame

        const clone = SkeletonUtils.clone(source);
        clone.traverse(o => { if (o.isMesh) o.castShadow = false; });

        let attached = clone;   // the static branch wraps it in a pivot
        const garmentSkins = [];
        clone.traverse(o => { if (o.isSkinnedMesh) garmentSkins.push(o); });

        if (garmentSkins.length) {
            // Properly rigged garment: rebind it to the player's own skeleton so
            // it deforms with him. Parenting this to a bone instead would apply
            // the chest transform on top of the skinning and tear it apart.
            // Requires the garment to have been weighted against this same
            // skeleton, so the joint ordering matches.
            let playerSkin = null;
            playerMesh.traverse(o => { if (!playerSkin && o.isSkinnedMesh) playerSkin = o; });
            if (!playerSkin) {
                console.warn('Worn tee: player has no skinned mesh to bind against');
                return;
            }
            for (const m of garmentSkins) m.bind(playerSkin.skeleton, playerSkin.bindMatrix);
            playerMesh.add(clone);
            console.log(`Worn tee: bound ${garmentSkins.length} skinned mesh(es) to the player skeleton`);
        } else {
            // Static garment (the CLO3D export): hang it off the chest bone and
            // fit it by measured height. Box3 is valid here precisely because
            // there's no skinning involved.
            const bone = findBone(playerMesh, WORN_TEE_BONE);
            if (!bone) {
                console.warn(`Worn tee: bone "${WORN_TEE_BONE}" not found on the player`);
                return;
            }

            clone.rotation.copy(WORN_TEE_ROTATION);
            clone.updateWorldMatrix(false, true);
            const teeBox = new THREE.Box3().setFromObject(clone);
            const teeHeight = teeBox.isEmpty() ? 0 : teeBox.max.y - teeBox.min.y;
            const teeCentre = teeBox.getCenter(new THREE.Vector3());

            bone.updateWorldMatrix(true, false);
            const boneScale = new THREE.Vector3().setFromMatrixScale(bone.matrixWorld).x || 1;

            // The garment's geometry does not sit on its own origin — this one
            // starts at minY 0.967, i.e. a whole unit above it — so attaching it
            // to the bone directly leaves it hovering. Wrap it in a pivot whose
            // origin is the measured centre of the mesh, so any garment sits
            // where its geometry actually is rather than where its origin is.
            const pivot = new THREE.Group();
            clone.position.sub(teeCentre);
            pivot.add(clone);

            // Scale on the pivot (about the geometry centre), dividing out the
            // bone's inherited scale so WORN_TEE_HEIGHT and the offset stay in
            // world units.
            if (teeHeight > 1e-6) {
                pivot.scale.setScalar(WORN_TEE_HEIGHT / (teeHeight * boneScale));
            }
            pivot.position.copy(WORN_TEE_OFFSET).divideScalar(boneScale);
            bone.add(pivot);
            attached = pivot;
            console.log(
                `Worn tee: attached to "${bone.name}", measured height ${teeHeight.toFixed(3)}, ` +
                `centre offset ${teeCentre.y.toFixed(3)}, bone scale ${boneScale.toFixed(3)} ` +
                `-> pivot scale ${pivot.scale.x.toFixed(4)}`
            );
        }

        wornTeeInstance = attached;
    }

    if (wornTeeInstance) wornTeeInstance.visible = shouldWear && !hasBike;
}

loader.load('playermodel.glb', (gltf) => {
    npcTemplate = optimizeModel(gltf.scene, { cap: TEX_CAP_CHAR });
    npcTemplate.scale.set(2.0, 2.0, 2.0);
    npcTemplate.traverse(o => {
        if (o.isMesh && o.material) {
            o.material.metalness = 0.0;
            o.material.roughness = 0.8;
            if (o.material.color) o.material.color.set(0xffffff);
        }
    });
    npcClips = gltf.animations;
    tryBuildPlayer();   // supplies the player's animation set too
}, undefined, (err) => console.error("NPC Model Error:", err));

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

    pendingBikeClips = gltf.animations;
    tryBuildBikeRider();   // the knight may already be loaded

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

// --- BELT PICKUP (procedural) ---
// Replaces belt.glb — 5MB, 40,000 triangles and a 2048px texture for what is
// visually a strip bent into a ring. This builds that ring directly: an
// open-ended cylinder with the texture wrapped once around so it meets itself
// at the seam. ~100 triangles, one texture, no model file.
const BELT_RADIUS = 1.0;
const BELT_SEGMENTS = 48;

new THREE.TextureLoader().load('belt_texture.png', (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = isIOS ? 1 : 4;

    const imgW = tex.image.width, imgH = tex.image.height;   // 113 x 858
    const circumference = 2 * Math.PI * BELT_RADIUS;

    // The texture is portrait, so its LONG axis is the one that travels around
    // the belt. Sizing the band from that ratio keeps the artwork undistorted
    // whatever the radius.
    const height = circumference * (imgW / imgH);

    const geo = new THREE.CylinderGeometry(
        BELT_RADIUS, BELT_RADIUS, height, BELT_SEGMENTS, 1, true /* openEnded */
    );

    // CylinderGeometry runs u around the circumference and v up the height,
    // which is the opposite of how this texture is laid out. Swapping the UV
    // components is more predictable than texture.rotation, which interacts
    // badly with wrapping.
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i), v = uv.getY(i);
        uv.setXY(i, v, u);
    }
    uv.needsUpdate = true;

    beltTemplate = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        map: tex,
        side: THREE.DoubleSide,  // the far inside of the band shows as it turns
        alphaTest: 0.35,         // cutout, so depth stays correct while spinning
        toneMapped: true
    }));

    console.log(`Belt: procedural ring r=${BELT_RADIUS} h=${height.toFixed(2)} from ${imgW}x${imgH} texture`);
});

window.mqBikeInfo = () => bikeRider ? {
    built: true,
    scale: +bikeRider.scale.x.toFixed(4),
    pos: bikeRider.position.toArray().map(v=>+v.toFixed(2)),
    alignResidual: bikeAlignResidual,
    // Count visible skinned meshes that are NOT part of the knight we added.
    originalRiderHidden: (() => {
        const mine = new Set();
        bikeRider.traverse(o => mine.add(o));
        let hidden = true;
        playerBikeMesh.traverse(o => {
            if (o.isSkinnedMesh && !mine.has(o) && o.visible) hidden = false;
        });
        return hidden;
    })(),
    playing: bikeRiderMixer ? bikeRiderMixer._actions.filter(a=>a.isRunning()).length : 0
 } : { built: false };

window.mqDebugBike = (on) => { hasBike = !!on; };

window.mqBeltInfo = () => beltTemplate ? {
    built: true,
    tris: beltTemplate.geometry.index
        ? beltTemplate.geometry.index.count / 3
        : beltTemplate.geometry.attributes.position.count / 3,
    height: +(beltTemplate.geometry.parameters.height).toFixed(2),
    spawned: powerups.filter(p => p.userData.type === 'armor_belt').length
} : { built: false };


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

    // Only the collider fallback needs a Y band, to stop rooftops counting as
    // road. DATA_ROAD meshes must NOT be Y-filtered — see below.
    const FALLBACK_MIN_Y = -20, FALLBACK_MAX_Y = 12;

    const grid    = new Uint8Array(NAV_DIM * NAV_DIM);
    const heights = new Float32Array(NAV_DIM * NAV_DIM);
    const sampled = new Uint8Array(NAV_DIM * NAV_DIM);   // did this cell get a real ground hit
    const down    = new THREE.Vector3(0, -1, 0);
    const rc      = new THREE.Raycaster();
    rc.firstHitOnly = true;

    // The height ray must see every surface it passes through, not just the
    // topmost one, so it can pick the street out from under bridges and roofs.
    const rcHeight = new THREE.Raycaster();
    rcHeight.firstHitOnly = false;

    // Must start above the tallest geometry. Shoreditch reaches world Y ~590,
    // so the previous origin of 500 began *inside* the map.
    const RAY_TOP = 2000;

    // Height is sampled from city geometry only — colliderMeshes also contains
    // the Border box, whose lid would answer for every cell.
    const heightMeshes = groundMeshes.length > 0 ? groundMeshes : colliderMeshes;

    let noHeight = 0;

    for (let gz = 0; gz < NAV_DIM; gz++) {
        for (let gx = 0; gx < NAV_DIM; gx++) {
            const wx = -NAV_HALF + gx * NAV_CELL + NAV_CELL * 0.5;
            const wz = -NAV_HALF + gz * NAV_CELL + NAV_CELL * 0.5;
            const i  = gz * NAV_DIM + gx;
            const origin = new THREE.Vector3(wx, RAY_TOP, wz);

            rc.set(origin, down);
            const hits = rc.intersectObjects(meshesToScan, false);
            if (hits.length === 0) continue;

            if (!useRoadMeshes) {
                if (hits[0].point.y > FALLBACK_MIN_Y && hits[0].point.y < FALLBACK_MAX_Y) {
                    grid[i] = 1;
                    heights[i] = hits[0].point.y;
                }
                continue;
            }

            // DATA_ROADS is a guidance layer, deliberately parked below the city
            // so it can be lined up in Blender (world Y ~-350 on shoreditch). It
            // answers "is there road here in XZ" — its own height is meaningless.
            // Y-filtering it rejected every single cell, which is why the grid
            // came out empty and navigation always fell back to a straight line.
            grid[i] = 1;

            // Height therefore has to come from the street surface above it, or
            // waypoints land 350 units underground and the trail is invisible.
            //
            // Take the LOWEST surface, not the first one hit. Casting down from
            // Y=2000 and accepting hits[0] returns whatever is on top of the
            // cell — a roof, a bridge deck, a scan artefact — which is why the
            // navigation trail climbed into the sky and the traffic drove up
            // into the air with it. The street is the bottom-most surface.
            rcHeight.set(origin, down);
            const ground = rcHeight.intersectObjects(heightMeshes, false);
            if (ground.length > 0) {
                heights[i] = ground[ground.length - 1].point.y;
                sampled[i] = 1;
            } else {
                heights[i] = 0;
                noHeight++;
            }
        }
    }

    // Median-filter across each road's neighbourhood. Picking the lowest hit
    // fixes overhangs, but the photogrammetry still has pits and spikes that a
    // single sample can land in; a median throws those out while preserving
    // genuine gradients (unlike a blur, which would drag hills flat).
    const smoothed = new Float32Array(heights);
    const bucket = [];
    let repaired = 0;
    for (let gz = 0; gz < NAV_DIM; gz++) {
        for (let gx = 0; gx < NAV_DIM; gx++) {
            const i = gz * NAV_DIM + gx;
            if (!grid[i]) continue;
            bucket.length = 0;
            for (let dz = -NAV_SMOOTH_R; dz <= NAV_SMOOTH_R; dz++) {
                const nz = gz + dz;
                if (nz < 0 || nz >= NAV_DIM) continue;
                for (let dx = -NAV_SMOOTH_R; dx <= NAV_SMOOTH_R; dx++) {
                    const nx = gx + dx;
                    if (nx < 0 || nx >= NAV_DIM) continue;
                    const j = nz * NAV_DIM + nx;
                    if (grid[j] && sampled[j]) bucket.push(heights[j]);
                }
            }
            if (bucket.length === 0) continue;
            bucket.sort((a, b) => a - b);
            const median = bucket[bucket.length >> 1];
            if (Math.abs(median - heights[i]) > 1.0) repaired++;
            smoothed[i] = median;
        }
    }

    navGrid = grid;
    navHeightGrid = smoothed;
    const roadCells = grid.reduce((s, v) => s + v, 0);
    console.log(
        `Nav grid built: ${NAV_DIM}x${NAV_DIM}, road cells: ${roadCells}` +
        ` (source: ${useRoadMeshes ? 'DATA_ROAD meshes' : 'collider fallback'})` +
        (noHeight ? `, ${noHeight} without a ground sample` : '') +
        `, ${repaired} heights corrected by the median filter`
    );
    if (roadCells === 0) {
        console.warn('Nav grid has no road cells — navigation will fall back to straight lines.');
    }
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
    if (!npcTemplate || !npcClips || roamingNPCs.length >= MAX_ROAMING_NPCS) return;

    const pos = getAnywhereSpawnPoint(playerGroup.position, 30, 150);
    if (!pos) return;

    // Civilians are the original player model — cloned from its own template so
    // they're unaffected by the player being a differently-scaled knight.
    const mesh = SkeletonUtils.clone(npcTemplate);
    mesh.position.copy(pos);
    // Give them a random tint so they're distinguishable
    mesh.traverse(o => {
        if (o.isMesh && o.material) {
            o.material = o.material.clone();
            o.material.color.setHSL(Math.random(), 0.4, 0.6);
        }
    });
    scene.add(mesh);

    // NPCs use playermodel's clips directly — same skeleton, no retarget needed.
    const npcMixer = new THREE.AnimationMixer(mesh);
    const idleClip  = THREE.AnimationClip.findByName(npcClips, 'Idle');
    const runClip   = THREE.AnimationClip.findByName(npcClips, 'Run');
    const punchClip = THREE.AnimationClip.findByName(npcClips, 'Punch');
    if (!idleClip || !runClip) return;

    const idleAction = npcMixer.clipAction(idleClip);
    const runAction  = npcMixer.clipAction(runClip);
    let punchAction = null;
    if (punchClip) {
        punchAction = npcMixer.clipAction(punchClip);
        punchAction.setLoop(THREE.LoopOnce);
        punchAction.clampWhenFinished = true;
    }
    idleAction.play();

    const target = getAnywhereSpawnPoint(pos, 20, 80) || pos.clone();

    roamingNPCs.push({
        mesh, mixer: npcMixer,
        idleAction, runAction, punchAction,
        currentAction: idleAction,
        target,
        waitTimer: 0,
        state: 'WALK',
        health: NPC_MAX_HEALTH,
        punchTimer: 0,      // cooldown between swings
        windup: -1,         // >= 0 while a thrown punch is travelling
        hitFlash: 0         // seconds of red tint remaining
    });
}

// --- TRAFFIC -----------------------------------------------------------------

for (const file of CAR_FILES) {
    loader.load(file, (gltf) => {
        const model = optimizeModel(gltf.scene, { cap: TEX_CAP_CHAR, castShadow: false });

        // The Golf's body material ships as metallicFactor 1.0. A fully metallic
        // PBR surface reflects its environment and nothing else, and this scene
        // has no environment map, so it rendered pure black. Force every car
        // dielectric — same workaround the bike loader already needs.
        model.traverse(o => {
            if (!o.isMesh || !o.material) return;
            for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
                if (mat.metalness !== undefined) mat.metalness = 0.0;
                if (mat.roughness !== undefined) mat.roughness = Math.min(mat.roughness ?? 0.8, 0.8);
            }
        });

        // Normalise to a consistent road-car size and work out which way the
        // model faces, so the two GLBs don't need to agree with each other.
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const longest = Math.max(size.x, size.z) || 1;
        const scale = CAR_LENGTH / longest;
        model.scale.multiplyScalar(scale);

        // These two models don't agree on where their origin is: the Jazz sits
        // on its wheels (minY 0.004) while the Golf's pivot is mid-body
        // (minY -3.353), which buried it in the road. Carry the offset from the
        // origin down to the lowest point so either can be planted on a surface.
        const lift = -box.min.y * scale;

        // Cars are driven along +Z; if the model is longest on X it's built
        // side-on and needs a quarter turn.
        carTemplates.push({ model, lift, yawFix: size.x > size.z ? Math.PI / 2 : 0 });
        let metals = 0;
        model.traverse(o => { if (o.isMesh && o.material && o.material.metalness === 0) metals++; });
        console.log(
            `Traffic: loaded ${file} (${size.x.toFixed(1)} x ${size.z.toFixed(1)} ` +
            `-> scaled ${scale.toFixed(3)}, ride height offset ${lift.toFixed(3)}, ` +
            `${metals} material(s) forced dielectric)`
        );
    }, undefined, (err) => console.error(`Traffic: failed to load ${file}`, err));
}

// Picks a route across the road graph starting somewhere near the player.
function pickCarRoute(from) {
    const start = getAnywhereSpawnPoint(from, CAR_SPAWN_MIN, CAR_SPAWN_MAX);
    if (!start) return null;
    const dest = getAnywhereSpawnPoint(start, 300, 1200);
    if (!dest) return null;
    const path = findRoadPath(start, dest);
    return path && path.length >= 3 ? path : null;
}

function spawnCar() {
    if (!carTemplates.length || !navGrid || cars.length >= MAX_CARS) return;

    const path = pickCarRoute(playerGroup.position);
    if (!path) return;

    const template = carTemplates[Math.floor(Math.random() * carTemplates.length)];
    const mesh = template.model.clone(true);
    mesh.position.copy(path[0]);

    // Start from a measured surface, not the nav grid's cell height — those are
    // wrong under roofs, and with the rate limiter a car that starts in the air
    // takes seconds to sink back down in full view.
    const surfaces = groundMeshes.length > 0 ? groundMeshes : colliderMeshes;
    raycaster.set(new THREE.Vector3(path[0].x, path[0].y + CAR_RAY_HEIGHT, path[0].z), downVector);
    const hit = raycaster.intersectObjects(surfaces, false);
    if (hit.length > 0) path[0].y = hit[0].point.y;

    mesh.position.y = path[0].y + template.lift;   // so it isn't buried on frame one
    scene.add(mesh);

    cars.push({
        mesh,
        yawFix: template.yawFix,
        lift: template.lift,
        path,
        index: 1,
        // The car's position on the road centreline. The mesh is drawn offset
        // from it, so the lane shift can't accumulate frame to frame.
        pos: path[0].clone(),
        speed: CAR_SPEED_MIN + Math.random() * (CAR_SPEED_MAX - CAR_SPEED_MIN),
        lane: Math.random() < 0.5 ? -CAR_LANE_OFFSET : CAR_LANE_OFFSET
    });
}

// Shortest distance from a point to the segment a->b. Used so a car sweeps its
// whole step against the player rather than testing a single position.
const _segAB = new THREE.Vector3(), _segAP = new THREE.Vector3(), _segClosest = new THREE.Vector3();
function distanceToSegment(point, a, b) {
    _segAB.subVectors(b, a);
    const lenSq = _segAB.lengthSq();
    if (lenSq < 1e-9) return point.distanceTo(a);
    _segAP.subVectors(point, a);
    const t = THREE.MathUtils.clamp(_segAP.dot(_segAB) / lenSq, 0, 1);
    _segClosest.copy(a).addScaledVector(_segAB, t);
    return point.distanceTo(_segClosest);
}

function removeCar(i) {
    scene.remove(cars[i].mesh);
    cars.splice(i, 1);
}

function updateTraffic(delta) {
    for (let i = cars.length - 1; i >= 0; i--) {
        const car = cars[i];

        // Route exhausted, or wandered too far to be worth simulating: recycle.
        if (car.index >= car.path.length ||
            car.mesh.position.distanceTo(playerGroup.position) > CAR_DESPAWN_DIST) {
            removeCar(i);
            continue;
        }

        const target = car.path[car.index];
        const to = new THREE.Vector3().subVectors(target, car.pos);
        to.y = 0;
        const dist = to.length();

        if (dist < 2.0) { car.index++; continue; }

        to.normalize();
        const wasAt = car.mesh.position.clone();

        car.pos.addScaledVector(to, car.speed * delta);

        // Face along travel, drawn one lane to the right of the centreline so
        // opposing traffic doesn't share a line.
        const side = new THREE.Vector3(to.z, 0, -to.x);
        car.mesh.position.copy(car.pos).addScaledVector(side, car.lane);
        car.mesh.rotation.set(0, Math.atan2(to.x, to.z) + car.yawFix, 0);

        // Sit on the surface the same way the player and NPCs do. The nav grid
        // only stores one height per 20-unit cell, so riding those values alone
        // left cars floating over crests and sunk into dips between waypoints.
        // Cast from the lane position, not the centreline — that's where the
        // wheels actually are.
        const surfaces = groundMeshes.length > 0 ? groundMeshes : colliderMeshes;
        raycaster.set(
            new THREE.Vector3(car.mesh.position.x, car.pos.y + CAR_RAY_HEIGHT, car.mesh.position.z),
            downVector
        );
        const ground = raycaster.intersectObjects(surfaces, false);

        // Neither height source can be trusted absolutely. The photogrammetry
        // road carries spikes no real car would climb, and the nav grid's
        // per-cell heights are wrong wherever a cell sits under a roof or an
        // overpass — anchoring to those was launching cars tens of units into
        // the air. So bound the *rate* of vertical change instead: a car tracks
        // the surface exactly while it's smooth, can only creep up a spike, and
        // settles back down under its own weight.
        const climb = CAR_MAX_CLIMB_RATE * delta;
        const fall  = CAR_MAX_FALL_RATE * delta;
        car.pos.y = ground.length > 0
            ? THREE.MathUtils.clamp(ground[0].point.y, car.pos.y - fall, car.pos.y + climb)
            : car.pos.y - fall;   // nothing beneath it — settle
        car.mesh.position.y = car.pos.y + car.lift;

        // Swept against the whole step, not just the end point. At 34 units/s a
        // dropped frame moves a car further than its own length, so a point test
        // would let it pass clean through the player.
        if (gameActive && distanceToSegment(playerGroup.position, wasAt, car.mesh.position) < CAR_HIT_RADIUS) {
            gameActive = false;
            isBusted = false;
            gameOverReason = 'runover';
            if (currentAction) currentAction.stop();
        }
    }
}

// Test hook: drives the nearest car onto the player, to exercise RUN OVER
// without waiting to be hit by chance.
window.mqDebugRunOver = () => {
    if (!cars.length) return false;
    const car = cars[0];
    car.lane = 0;                       // otherwise it passes to one side
    car.pos.copy(playerGroup.position);
    car.mesh.position.copy(playerGroup.position);
    return true;
};

window.mqGameOverReason = () => gameOverReason;

window.mqCameraInfo = () => ({ yaw: +cameraAngle.toFixed(4), pitch: +cameraPitch.toFixed(4) });

// Steepness of the navigation path. A road-following route should be close to
// flat; anything steep means the nav grid's heights have picked up a roof or a
// bridge deck again, which is what sent the trail climbing into the sky.
window.mqNavPathInfo = () => {
    if (!currentNavPath || currentNavPath.length < 2) return { waypoints: currentNavPath ? currentNavPath.length : 0, maxSlopeDeg: null };
    let maxSlope = 0, maxRise = 0;
    for (let i = 1; i < currentNavPath.length; i++) {
        const a = currentNavPath[i - 1], b = currentNavPath[i];
        const flat = Math.hypot(b.x - a.x, b.z - a.z);
        const rise = Math.abs(b.y - a.y);
        maxRise = Math.max(maxRise, rise);
        if (flat > 1e-3) maxSlope = Math.max(maxSlope, THREE.MathUtils.radToDeg(Math.atan2(rise, flat)));
    }
    return {
        waypoints: currentNavPath.length,
        maxSlopeDeg: +maxSlope.toFixed(1),
        maxRise: +maxRise.toFixed(2)
    };
};

// How wide is each road, in grid cells? The scraped DATA_ROADS geometry doesn't
// say which ways are drivable — a service alley and a bus route are the same
// polyline — but corridor width is a decent proxy: a real street spans several
// cells across, a footpath spans one. Reports the distribution so a traffic
// width threshold can be chosen from data rather than guessed.
window.mqNavStats = () => {
    if (!navGrid) return null;
    const at = (gx, gz) => (gx < 0 || gz < 0 || gx >= NAV_DIM || gz >= NAV_DIM) ? 0 : navGrid[gz * NAV_DIM + gx];
    const run = (gx, gz, dx, dz) => {
        let n = 1;
        for (let i = 1; i < 12 && at(gx + dx * i, gz + dz * i); i++) n++;
        for (let i = 1; i < 12 && at(gx - dx * i, gz - dz * i); i++) n++;
        return n;
    };
    const hist = new Map();
    let total = 0;
    for (let gz = 0; gz < NAV_DIM; gz++) {
        for (let gx = 0; gx < NAV_DIM; gx++) {
            if (!at(gx, gz)) continue;
            total++;
            // Narrowest of the two axes approximates the corridor width: a road
            // running east-west is long on X and only a few cells thick on Z.
            const w = Math.min(run(gx, gz, 1, 0), run(gx, gz, 0, 1));
            hist.set(w, (hist.get(w) || 0) + 1);
        }
    }
    const widths = [...hist.entries()].sort((a, b) => a[0] - b[0]);
    return {
        cellSize: NAV_CELL,
        roadCells: total,
        byWidth: widths.map(([w, n]) => ({
            cells: w, worldUnits: w * NAV_CELL, count: n, pct: +(n / total * 100).toFixed(1)
        })),
        survivingAtThreshold: [2, 3, 4, 5].map(t => ({
            minCells: t,
            minWorldUnits: t * NAV_CELL,
            cells: widths.filter(([w]) => w >= t).reduce((s, [, n]) => s + n, 0)
        }))
    };
};

window.mqTrafficInfo = () => {
    // `gap` measures each car's underside against the surface directly beneath
    // it: ~0 means planted, negative means sunk into the road.
    const surfaces = groundMeshes.length > 0 ? groundMeshes : colliderMeshes;
    return {
        templates: carTemplates.length,
        cars: cars.length,
        detail: cars.map(c => {
            const box = new THREE.Box3().setFromObject(c.mesh);
            raycaster.set(
                new THREE.Vector3(c.mesh.position.x, c.mesh.position.y + CAR_RAY_HEIGHT, c.mesh.position.z),
                downVector
            );
            const hit = raycaster.intersectObjects(surfaces, false);
            return {
                dist: +c.mesh.position.distanceTo(playerGroup.position).toFixed(1),
                waypoint: `${c.index}/${c.path.length}`,
                size: [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z]
                    .map(v => +v.toFixed(1)),
                gap: hit.length ? +(box.min.y - hit[0].point.y).toFixed(2) : null
            };
        })
    };
};

// Idle crowd behaviour: stroll to a point, pause, pick another. This is what
// NPCs do whenever they aren't chasing the player.
function updateWanderingNPC(npc, delta) {
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
        return;
    }

    const dir = new THREE.Vector3().subVectors(npc.target, npc.mesh.position).normalize();
    npc.mesh.position.addScaledVector(dir, NPC_WALK_SPEED * delta);
    npc.mesh.lookAt(npc.target.x, npc.mesh.position.y, npc.target.z);

    raycaster.set(
        new THREE.Vector3(npc.mesh.position.x, npc.mesh.position.y + 10, npc.mesh.position.z),
        downVector
    );
    const hits = raycaster.intersectObjects(colliderMeshes, false);
    if (hits.length > 0) {
        npc.mesh.position.y = THREE.MathUtils.lerp(npc.mesh.position.y, hits[0].point.y, 10 * delta);
    }
}

// Applies one punch of damage to an NPC, and returns true if that killed it.
// Kept separate from the punch handler so the hit feedback lives in one place.
function damageNPC(npc, index) {
    npc.health -= 1;
    npc.hitFlash = 0.18;

    // A small shove, so a hit reads as contact rather than clipping. Kept well
    // under PLAYER_PUNCH_RANGE or it would knock them out of reach of the
    // follow-up and every second punch would whiff.
    const away = new THREE.Vector3().subVectors(npc.mesh.position, playerGroup.position);
    away.y = 0;
    if (away.lengthSq() > 1e-6) npc.mesh.position.addScaledVector(away.normalize(), 0.6);

    if (npc.health > 0) {
        // Being hit interrupts whatever they were doing and re-commits them.
        npc.state = 'CHASE';
        npc.punchTimer = Math.max(npc.punchTimer, 0.6);
        npc.windup = -1;
        return false;
    }

    scene.remove(npc.mesh);
    roamingNPCs.splice(index, 1);
    setTimeout(() => spawnRoamingNPC(), NPC_RESPAWN_DELAY);
    return true;
}

// Damage to the player: armour soaks it first, which is what the tee and belt
// pickups are for. Returns true if this was the punch that finished him.
function damagePlayer(amount) {
    if (playerHurtTimer > 0 || !gameActive) return false;
    playerHurtTimer = PLAYER_HIT_INVULN;
    playerHitFlash = 0.35;

    if (armor > 0) {
        armor = Math.max(0, armor - amount);
        return false;
    }

    playerHealth -= amount;
    if (playerHealth > 0) return false;

    playerHealth = 0;
    gameActive = false;
    isBusted = true;
    gameOverReason = 'busted';
    if (currentAction) currentAction.stop();
    return true;
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
            // FALLBACK (texture still loading)
            mesh = new THREE.Mesh(new THREE.TorusGeometry(0.3,0.05), new THREE.MeshBasicMaterial({color: 0x8B4513}));
        }

        // The ring is centred on its own origin, so it sits level with the glow
        // rather than needing the drop the old model did.
        mesh.position.y = 0.0;

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
    if (k === 'f' || k === 'e') keys.punch = true;   // Circle on the pad
    if (k === 'p') isPaused = !isPaused;
    if (k === 'm') isMapOpen = !isMapOpen;
    if (k === 't') { isTimerRunning = !isTimerRunning; }
    if (k === 'i') toggleStats();
});
window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (keys.hasOwnProperty(k)) keys[k] = false;
    if (k === 'f' || k === 'e') keys.punch = false;
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
    // With the composer active (desktop), renderer.info reports only the final
    // OutputPass quad, not the scene — so draws/tris are meaningless there.
    const perPass = composer ? ' (last pass)' : '';
    statsEl.textContent =
        `fps      ${lastFps.toFixed(0)}  (scale ${qualityScale.toFixed(2)})\n` +
        `draws    ${s.calls}${perPass}\n` +
        `tris     ${(s.tris / 1000).toFixed(0)}k${perPass}\n` +
        `textures ${s.textures}\n` +
        `geoms    ${s.geometries}\n` +
        `pickups  ${s.powerups}/${MAX_POWERUPS}\n` +
        `police   ${s.enemies}\n` +
        // 0 route points means A* found nothing and the trail is pointing
        // straight at the beacon rather than following roads.
        `route    ${currentNavPath.length} pts${currentNavPath.length ? '' : '  (STRAIGHT LINE)'}`;
}

function animate() {
    requestAnimationFrame(animate);

    const rawDelta = clock.getDelta();
    const delta = Math.min(rawDelta, 0.05);

    updateAdaptiveQuality(rawDelta);
    updateStats(delta);

    
    // Update Player Animations (Human or Bike)
    if (hasBike && bikeMixer) {
        bikeMixer.update(delta);          // wheels, pedals, frame
        if (bikeRiderMixer) bikeRiderMixer.update(delta);  // the knight pedalling
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

    // Drives the pulses running along the navigation trail.
    trailMat.uniforms.uTime.value = clock.elapsedTime;

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
            gameOverReason = 'time';
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
                    gameOverReason = 'busted';
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

    // TRAFFIC — runs while the game is live; cars top themselves up as they
    // drive off the end of their route or out of range.
    if (gameActive) {
        updateTraffic(delta);
        carSpawnTimer += delta;
        if (carSpawnTimer > CAR_SPAWN_RATE) {
            carSpawnTimer = 0;
            spawnCar();
        }
    }

    // ROAMING NPCs
    if (gameActive) {
        playerPunchTimer = Math.max(0, playerPunchTimer - delta);
        playerHurtTimer  = Math.max(0, playerHurtTimer - delta);
        playerHitFlash   = Math.max(0, playerHitFlash - delta);

        // Iterated backwards: damageNPC() splices the dead out of the array.
        for (let i = roamingNPCs.length - 1; i >= 0; i--) {
            const npc = roamingNPCs[i];
            npc.mixer.update(delta);
            npc.punchTimer = Math.max(0, npc.punchTimer - delta);

            // Red tint while a hit is registering, then back to their own colour.
            if (npc.hitFlash > 0) {
                npc.hitFlash -= delta;
                const lit = npc.hitFlash > 0;
                npc.mesh.traverse(o => {
                    if (!o.isMesh || !o.material || !o.material.emissive) return;
                    if (lit) o.material.emissive.setRGB(0.6, 0, 0);
                    else o.material.emissive.setRGB(0, 0, 0);
                });
            }

            const toPlayer = new THREE.Vector3().subVectors(playerGroup.position, npc.mesh.position);
            toPlayer.y = 0;
            const playerDist = toPlayer.length();

            // A bike outruns them, so they don't bother giving chase.
            const canAggro = !hasBike;
            if (npc.state !== 'CHASE' && canAggro && playerDist < NPC_AGGRO_RADIUS) {
                npc.state = 'CHASE';
            } else if (npc.state === 'CHASE' && (!canAggro || playerDist > NPC_LOSE_RADIUS)) {
                npc.state = 'WAIT';
                npc.waitTimer = 0.5;
                npc.windup = -1;
            }

            if (npc.state === 'CHASE') {
                npc.mesh.lookAt(playerGroup.position.x, npc.mesh.position.y, playerGroup.position.z);

                // A punch already thrown lands (or misses) on its own schedule,
                // so the animation and the damage stay in step.
                if (npc.windup >= 0) {
                    npc.windup -= delta;
                    if (npc.windup <= 0) {
                        npc.windup = -1;
                        if (playerDist < NPC_PUNCH_RANGE * 1.3) damagePlayer(1);
                    }
                } else if (playerDist > NPC_PUNCH_RANGE) {
                    npc.mesh.position.addScaledVector(
                        toPlayer.normalize(), NPC_CHASE_SPEED * delta
                    );
                    if (npc.currentAction !== npc.runAction) {
                        npc.runAction.reset().fadeIn(0.2).play();
                        if (npc.currentAction) npc.currentAction.fadeOut(0.2);
                        npc.currentAction = npc.runAction;
                    }
                } else if (npc.punchTimer <= 0) {
                    npc.punchTimer = NPC_PUNCH_COOLDOWN;
                    npc.windup = NPC_PUNCH_WINDUP;
                    if (npc.punchAction) {
                        npc.punchAction.reset().fadeIn(0.05).play();
                        if (npc.currentAction && npc.currentAction !== npc.punchAction) {
                            npc.currentAction.fadeOut(0.05);
                        }
                        npc.currentAction = npc.punchAction;
                    }
                } else if (npc.currentAction !== npc.idleAction && !npc.punchAction) {
                    npc.idleAction.reset().fadeIn(0.2).play();
                    if (npc.currentAction) npc.currentAction.fadeOut(0.2);
                    npc.currentAction = npc.idleAction;
                }

                raycaster.set(
                    new THREE.Vector3(npc.mesh.position.x, npc.mesh.position.y + 10, npc.mesh.position.z),
                    downVector
                );
                const groundHits = raycaster.intersectObjects(colliderMeshes, false);
                if (groundHits.length > 0) {
                    npc.mesh.position.y = THREE.MathUtils.lerp(npc.mesh.position.y, groundHits[0].point.y, 10 * delta);
                }
                continue;
            }

            updateWanderingNPC(npc, delta);
        }
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

            // 2b. PUNCH — takes NPC_MAX_HEALTH landed hits to drop someone, so
            // the cooldown is what paces a fight rather than the clip length.
            if (keys.punch && !hasBike && playerPunchTimer <= 0) {
                playerPunchTimer = PLAYER_PUNCH_COOLDOWN;

                const punchAnim = animationsMap.get('Punch');
                if (punchAnim) {
                    punchAnim.clampWhenFinished = true;
                    punchAnim.reset().setLoop(THREE.LoopOnce).play();
                    if (currentAction && currentAction !== punchAnim) currentAction.fadeOut(0.1);
                    currentAction = punchAnim;
                }

                // Everyone in front of the player and in reach takes one.
                const punchDir = new THREE.Vector3(Math.sin(cameraAngle), 0, Math.cos(cameraAngle));
                for (let i = roamingNPCs.length - 1; i >= 0; i--) {
                    const npc = roamingNPCs[i];
                    const toNPC = new THREE.Vector3().subVectors(npc.mesh.position, playerGroup.position);
                    toNPC.y = 0;
                    const dist = toNPC.length();
                    if (dist < PLAYER_PUNCH_RANGE && toNPC.normalize().dot(punchDir) > PLAYER_PUNCH_ARC) {
                        damageNPC(npc, i);
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
                    // Remembered even mid-jump: the contact shadow needs the
                    // surface below the player, not the player's own height.
                    playerGroundY = hitY;
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

            // The trail hides briefly while airborne so it doesn't cut through the
            // camera on big jumps, but always shows a route otherwise.
            const trailActive = navLineGroundTimer > 0;
            const trailWidth  = isMapOpen ? TRAIL_WIDTH_MAP : TRAIL_WIDTH_GAME;

            // Rebuilt at ~8fps — the Catmull-Rom resample is too costly per frame,
            // and the ribbon doesn't visibly lag at this rate.
            navLineUpdateTimer += delta;
            if (trailActive) {
                if (navLineUpdateTimer >= 0.12 || trailWidth !== lastTrailWidth) {
                    navLineUpdateTimer = 0;
                    lastTrailWidth = trailWidth;

                    const SKIP_DIST = 10;
                    const rawPts = [];
                    const firstWp = currentNavPath[currentNavIndex] || beaconGroup.position;
                    const toFirst = new THREE.Vector3().subVectors(firstWp, playerGroup.position);
                    if (toFirst.length() > SKIP_DIST) {
                        const skipStart = playerGroup.position.clone()
                            .addScaledVector(toFirst.normalize(), SKIP_DIST);
                        skipStart.y += TRAIL_LIFT;
                        rawPts.push(skipStart);
                    }
                    for (let pi = currentNavIndex; pi < currentNavPath.length; pi++) {
                        const wp = currentNavPath[pi].clone();
                        wp.y += TRAIL_LIFT;
                        rawPts.push(wp);
                    }
                    // No road path yet (grid still building, or beacon off-road):
                    // run the trail straight at the beacon rather than falling back
                    // to a separate arrow widget.
                    if (rawPts.length < 2) {
                        const a = playerGroup.position.clone(); a.y += TRAIL_LIFT;
                        const b = beaconGroup.position.clone(); b.y += TRAIL_LIFT;
                        if (a.distanceTo(b) > SKIP_DIST) {
                            a.addScaledVector(b.clone().sub(a).normalize(), SKIP_DIST);
                            rawPts.length = 0;
                            rawPts.push(a, b);
                        }
                    }

                    if (rawPts.length >= 2) {
                        const curve = new THREE.CatmullRomCurve3(rawPts);
                        const smooth = curve.getPoints(
                            Math.min(Math.max(rawPts.length * 5, 30), TRAIL_MAX_POINTS - 1)
                        );
                        buildTrail(smooth, trailWidth);
                        navTrail.visible = true;
                    } else {
                        navTrail.visible = false;
                    }
                }
            } else {
                navTrail.visible = false;
                navLineUpdateTimer = 0.12; // force an immediate rebuild when it returns
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
    updateWornTee();

    // Sun frustum and contact shadows both key off the player's final position
    // for this frame, so they run after all movement is resolved.
    if (playerGroup) updateSunRig(playerGroup.position);
    updateContactShadows();

    // RENDER — one graded fullscreen pass on top of the scene, all platforms.
    if (composer) {
        // Grain has to move or it reads as dirt on the lens.
        if (gradePass) gradePass.uniforms.uTime.value += delta;
        composer.render();
    } else {
        renderer.render(scene, camera);
    }
}

// CAMERA
     let targetPos, targetLook;
     let targetFogNear, targetFogFar;

     if (isMapOpen) {
         targetPos = playerGroup.position.clone().add(new THREE.Vector3(0, 200, 0)); 
        targetLook = playerGroup.position.clone();
         targetFogNear = currentLook.mapFogNear;
         targetFogFar = currentLook.mapFogFar;
         beaconGroup.scale.set(4, 4, 4);
     } else {
        const offset = new THREE.Vector3(
            0,
            Math.sin(cameraPitch) * CAMERA_DISTANCE,
            -Math.cos(cameraPitch) * CAMERA_DISTANCE
        ).applyAxisAngle(new THREE.Vector3(0, 1, 0), cameraAngle);
         targetPos = playerGroup.position.clone().add(offset);
        targetLook = playerGroup.position.clone().add(new THREE.Vector3(0, 2, 0));
        targetFogNear = currentLook.fogNear;
         targetFogFar = currentLook.fogFar;
         beaconGroup.scale.set(1, 1, 1);
     }

    camera.position.lerp(targetPos, 0.1);
    currentLookAt.lerp(targetLook, 0.1);
    camera.lookAt(currentLookAt);
        
             scene.fog.near = THREE.MathUtils.lerp(scene.fog.near, targetFogNear, 0.05);
    scene.fog.far = THREE.MathUtils.lerp(scene.fog.far, targetFogFar, 0.05);
 }

animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (composer) composer.setSize(window.innerWidth, window.innerHeight);
    
    renderer.setPixelRatio(targetPixelRatio() * qualityScale);

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


