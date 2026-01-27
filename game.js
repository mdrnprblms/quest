import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'; 
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// --- POST-PROCESSING IMPORTS ---
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// --- LOADING SCREEN SETUP ---
const loadingScreen = document.createElement('div');
loadingScreen.id = 'loading-screen';
loadingScreen.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: #000; color: #00ff00; display: flex; 
    justify-content: center; align-items: center; 
    font-family: 'Courier New', Courier, monospace; 
    font-size: 30px; font-weight: bold; z-index: 9999;
    flex-direction: column;
`;
loadingScreen.innerHTML = `<div>LOADING MAP...</div><div style="font-size:14px; margin-top:10px; opacity:0.7;">PLEASE WAIT</div>`;
document.body.appendChild(loadingScreen);

// --- GAME LOOP ---
const keys = { w: false, a: false, s: false, d: false, space: false, k: false };
let cameraAngle = 0;
const cameraRotationSpeed = 0.03;
const currentLookAt = new THREE.Vector3(0, 0, 0);

// Define your maps array near the top of the file (with other configs) or right here
const maps = ['shoreditch.glb', 'archway.glb', 'carnabyst.glb'];
let currentMapIndex = 0; // Make sure this variable exists in your state variables

window.switchMap = () => {
    // Cycle to the next map index
    currentMapIndex = (currentMapIndex + 1) % maps.length;
    currentMapName = maps[currentMapIndex];
    
    // Load the new map
    loadLevel(currentMapName);
    
    // De-focus button so spacebar doesn't trigger it again
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
    drinkTimer = 0;
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
    
    // MASSIVE SPAWN ON RESET
    for(let i=0; i<50; i++) spawnPowerup(); 

    // 7. Hide UI
    const uiGameOver = document.getElementById('game-over');
    if (uiGameOver) uiGameOver.style.display = 'none';
};

// --- MOBILE CONTROLS SETUP ---
let joystickInput = { x: 0, y: 0 };
let joystickManager;

setTimeout(() => {
    const zone = document.getElementById('zone_joystick');
    if (typeof nipplejs !== 'undefined' && zone) {
        joystickManager = nipplejs.create({
            zone: zone,
            mode: 'static',
            position: { left: '50%', top: '50%' },
            color: 'white',
            size: 100
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

    const jumpBtn = document.getElementById('mobile-jump');
    if (jumpBtn) {
        jumpBtn.addEventListener('touchstart', (e) => {
            e.preventDefault(); 
            keys.space = true;
        }, { passive: false });
        jumpBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            keys.space = false;
            jumpLocked = false; 
        }, { passive: false });
    }
}, 500);

// --- 1. CONFIGURATION ---
const START_TIME = 90.0;    
const TIME_BONUS = 30.0;    
const BASE_SPEED = 20.0; 
const BIKE_MULTIPLIER = 1.8; 
const DRINK_MULTIPLIER = 1.4; 
const DRINK_DURATION = 15.0;
const POWERUP_SPAWN_RATE = 10; // DRAMATICALLY INCREASED RATE (0.5s instead of 5.0s)

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
let gameActive = true;
let isPaused = false; 
let isTimerRunning = true;
let hasBike = false; 
let drinkTimer = 0.0; 
let isMapOpen = false; 
let spawnTimer = 0; 
let isBusted = false;

// PHYSICS STATE
let verticalVelocity = 0;
let isGrounded = true;
let jumpLocked = false;
const GRAVITY = -60.0;      
const JUMP_FORCE = 30.0;    

// DATA STORE
let validRoadPositions = []; 
let colliderMeshes = []; 
let roadMeshes = []; // NEW: Stores DATA_ROADS
let powerups = []; 

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
        if (hasBike && drinkTimer > 0) status = "STACKING IT"; 
        else if (hasBike) status = "ON BIKE";
        else if (drinkTimer > 0) status = "SUGAR RUSH";
        
        let wantedStars = "";
        if (score >= WANTED_LEVEL_2_SCORE) wantedStars = "★★";
        else if (score >= WANTED_LEVEL_1_SCORE) wantedStars = "★";
        
        uiScore.innerText = `${score} | 🛡️ ${armor} | ${status} ${wantedStars}`;
    }

    if(uiTimer) {
        uiTimer.innerText = timeLeft.toFixed(1);
        uiTimer.className = timeLeft < 10 ? "danger" : "highlight";
    }
    
    if (uiDrink && uiBike) {
        if (hasBike) uiBike.style.display = 'block';
        else uiBike.style.display = 'none';

        if (drinkTimer > 0) {
            uiDrink.style.display = 'block';
            uiDrinkTimer.innerText = drinkTimer.toFixed(1);
        } else {
            uiDrink.style.display = 'none';
        }
    }
    
    if(uiPause) uiPause.style.display = isPaused ? "block" : "none";
    
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
                    <div style="font-size: 80px; color: ${color}; text-shadow: 2px 2px #000;">${titleText}</div>
                    <div style="font-size: 24px; color: #fff;">SCORE: ${score}</div>
                    <button id="retry-btn" style="
                        padding: 15px 40px; 
                        font-size: 24px; 
                        font-family: 'Courier New', monospace; 
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

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; 
renderer.useLegacyLights = false; 
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

// --- POST-PROCESSING SETUP (BOKEH) ---
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const bokehPass = new BokehPass(scene, camera, {
    focus: 10.0,       // Distance to focus on (will update dynamically)
    aperture: 0.00002,  // Blur strength (0.0001 is subtle, 0.0002 is strong)
    maxblur: 0.01,     // Max blur level
    width: window.innerWidth,
    height: window.innerHeight
});
composer.addPass(bokehPass);

const outputPass = new OutputPass();
composer.addPass(outputPass);

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
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 1024; 
dirLight.shadow.mapSize.height = 1024;
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

// ARROW
const arrowMesh = new THREE.Mesh(
    new THREE.ConeGeometry(0.5, 1.5, 8),
    new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.8 }) 
);
arrowMesh.geometry.rotateX(Math.PI / 2); 
arrowMesh.position.y = 6; 
playerGroup.add(arrowMesh);

// --- MAP LOADER FUNCTION ---
function loadLevel(mapName) {
    console.log("Loading Map:", mapName);
    document.getElementById('loading-screen').style.display = 'flex';
    
    while(cityGroup.children.length > 0){ cityGroup.remove(cityGroup.children[0]); }
    colliderMeshes = [];
    roadMeshes = []; // Reset road meshes
    validRoadPositions = [];
    powerups.forEach(p => scene.remove(p));
    powerups = [];
    activeEnemies.forEach(e => { enemiesGroup.remove(e.groupRef); });
    activeEnemies = [];

    loader.load(mapName, (gltf) => {
        const map = gltf.scene;
        map.scale.set(3, 3, 3);
        
        const box = new THREE.Box3().setFromObject(map);
        const center = box.getCenter(new THREE.Vector3());
        map.position.x += (map.position.x - center.x);
        map.position.z += (map.position.z - center.z);
        map.position.y = -0.2; 

        map.traverse((child) => {
            if (child.isMesh) {
                // 1. DATA ROADS (New Logic)
                if (child.name.includes("DATA_ROADS")) {
                    // It is a road mesh. We keep it for raycasting but hide it.
                    child.visible = false; 
                    roadMeshes.push(child);
                }
                else if (child.name.includes("Border") || child.name.includes("border")) {
                    child.visible = false;       
                    colliderMeshes.push(child);  
                } 
                else if (child.name !== "IGNORE_ME") {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    child.name = "CITY_MESH"; 
                    colliderMeshes.push(child); // Buildings / Ground
                    if (child.material) {
                        child.material.roughness = 0.9;
                        child.material.metalness = 0.1;
                        child.material.side = THREE.DoubleSide; 
                    }
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
        
        spawnBeacon();
        
        // --- MASSIVE POWERUP SPAWN ---
        // Spawn 100 random items immediately across the map
        for(let i=0; i<100; i++) {
            spawnPowerup();
        }
        
        document.getElementById('loading-screen').style.display = 'none';

    }, undefined, (err) => {
        console.error("Map Error:", err);
        alert("Could not load map: " + mapName);
        document.getElementById('loading-screen').style.display = 'none';
    });
}

loadLevel(currentMapName);

// --- PLAYER LOADER ---
let playerMesh;
let mixer;
let animationsMap = new Map();
let currentAction;

loader.load('playermodel.glb', (gltf) => {
    playerMesh = gltf.scene;
    playerMesh.scale.set(2.0, 2.0, 2.0); 
    playerMesh.rotation.y = Math.PI; 
    
    playerMesh.traverse(o => { 
        if (o.isMesh) { 
            o.castShadow = true; 
            o.receiveShadow = true;
            if (o.material) {
                o.material.metalness = 0.0; 
                o.material.roughness = 0.8; 
                if (o.material.color) o.material.color.set(0xffffff);
            }
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
    playerBikeMesh = gltf.scene;
    playerBikeMesh.scale.set(2.0, 2.0, 2.0); 
    playerBikeMesh.rotation.y = THREE.MathUtils.degToRad(180);
    playerBikeMesh.visible = false; // Hidden by default (until powerup collected)

    playerBikeMesh.traverse(o => { 
        if (o.isMesh) { 
            o.castShadow = true; 
            o.receiveShadow = true;
            // Fix dark materials if necessary
            if (o.material) {
                o.material.metalness = 0.0; 
                o.material.roughness = 0.8; 
                if (o.material.color) o.material.color.set(0xffffff);
            }
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
    policeTemplate = gltf.scene;
    
    policeTemplate.traverse(o => { 
        if (o.isMesh) { 
            o.castShadow = true; 
            o.receiveShadow = true;
        } 
    });
    
    policeClips = gltf.animations;
    console.log("Police Template Loaded");
}, undefined, (err) => console.error("Police Model Error:", err));


// --- POWERUP ASSETS ---
loader.load('limebike.glb', (gltf) => {
    bikeTemplate = gltf.scene;
    bikeTemplate.scale.set(2.5, 2.5, 2.5);
    bikeTemplate.traverse(o => { 
        if(o.isMesh) { 
            o.castShadow = true; o.receiveShadow = true;
            if (o.material) {
                o.material.color.set(0xffffff);
                o.material.metalness = 0.1; 
                o.material.roughness = 0.5;
                o.material.emissive = new THREE.Color(0x222222); 
            }
        }
    });
});

loader.load('monster_zero_ultra.glb', (gltf) => {
    drinkTemplate = gltf.scene;
    drinkTemplate.scale.set(0.6, 0.6, 0.6);
    drinkTemplate.traverse(o => { if(o.isMesh) { o.castShadow = true; o.receiveShadow = true; }});
});

loader.load('liontee.glb', (gltf) => {
    lionTeeTemplate = gltf.scene;
    lionTeeTemplate.scale.set(5, 5, 5); 
    lionTeeTemplate.traverse(o => { if(o.isMesh) { o.castShadow = true; o.receiveShadow = true; }});
});

loader.load('lionteegrey.glb', (gltf) => {
    lionTeeGreyTemplate = gltf.scene;
    lionTeeGreyTemplate.scale.set(5, 5, 5);
    lionTeeGreyTemplate.traverse(o => { if(o.isMesh) { o.castShadow = true; o.receiveShadow = true; }});
});

loader.load('belt.glb', (gltf) => {
    beltTemplate = gltf.scene;
    beltTemplate.scale.set(2.0, 2.0, 2.0); 
    beltTemplate.traverse(o => { if(o.isMesh) { o.castShadow = true; o.receiveShadow = true; }});
});


// --- 5. LOGIC & SPAWNING ---
const raycaster = new THREE.Raycaster();
const downVector = new THREE.Vector3(0, -1, 0);

function canMove(position, direction) {
    const rayStart = position.clone();
    rayStart.y += 1.5; 
    raycaster.set(rayStart, direction);
    const intersects = raycaster.intersectObjects(colliderMeshes, false); 
    if (intersects.length > 0) {
        if (intersects[0].distance < 1.5) return false; 
    }
    return true; 
}

function getAnywhereSpawnPoint(centerPos, minRadius, maxRadius) {
    // If no road meshes found, fallback to old logic (collisions with floor)
    const useRoadLogic = roadMeshes.length > 0;
    // We search against everything (including hidden roads)
    const searchMeshes = useRoadLogic ? [...roadMeshes, ...colliderMeshes] : colliderMeshes;

    // Increased maxTries because finding a specific road is harder than just "any floor"
    const maxTries = 200; 
    
    for (let i = 0; i < maxTries; i++) {
        let radius = minRadius + Math.random() * (maxRadius - minRadius);
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
    // OLD: let pos = getAnywhereSpawnPoint(playerGroup.position, 50, 300);
    
    // NEW: Spawns between 400 and 1500 units away from the player
    let pos = getAnywhereSpawnPoint(playerGroup.position, 400, 1500);
    
    if (pos) {
        beaconGroup.position.copy(pos);
    } else {
        // Fallback: If no valid spot found, put it 100 units away instead of 20
        beaconGroup.position.set(playerGroup.position.x + 100, 0, playerGroup.position.z);
    }
    updateWantedSystem();
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

function spawnPowerup() {
    // Try to get a valid road position 
    // We check anywhere from center (0,0) out to MAP_LIMIT (4000)
    let pos = getAnywhereSpawnPoint(new THREE.Vector3(0,0,0), 0, MAP_LIMIT * 0.9);
    
    if (!pos) return;

    const roll = Math.random();
    let type = 'bike';
    if (roll > 0.80) type = 'armor_tee';
    else if (roll > 0.60) type = 'armor_belt';
    else if (roll > 0.30) type = 'drink';

    createPowerupGroup(type, pos);
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
        if (useGrey && lionTeeGreyTemplate) group.add(lionTeeGreyTemplate.clone());
        else if (!useGrey && lionTeeTemplate) group.add(lionTeeTemplate.clone());
        
        else {
            // FALLBACK
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8,0.8,0.1), new THREE.MeshBasicMaterial({color: 0xFFD700}));
            group.add(mesh);
        }
        group.userData = { type: 'armor_tee', active: true };
    }
    else if (type === 'armor_belt') { 
        if (beltTemplate) group.add(beltTemplate.clone());
        else {
            // FALLBACK
            const mesh = new THREE.Mesh(new THREE.TorusGeometry(0.3,0.05), new THREE.MeshBasicMaterial({color: 0x8B4513}));
            group.add(mesh);
        }
        group.userData = { type: 'armor_belt', active: true };
    }
    
    //const laser = new THREE.Line(
    //    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), new THREE.Vector3(0,50,0)]),
    //    new THREE.LineBasicMaterial({ color: 0xFF00FF })
    //);
    //group.add(laser);

    scene.add(group);
    powerups.push(group);
}




window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); }
    if (keys.hasOwnProperty(k)) keys[k] = true;
    if (k === ' ') keys.space = true; 
    if (k === 'p') isPaused = !isPaused;
    if (k === 'm') isMapOpen = !isMapOpen;
    if (k === 't') { isTimerRunning = !isTimerRunning; }
});
window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (keys.hasOwnProperty(k)) keys[k] = false;
    if (k === ' ') {
        keys.space = false;
        jumpLocked = false; 
    }
});

const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    
    const rawDelta = clock.getDelta();
    const delta = Math.min(rawDelta, 0.05);

    
    // Update Player Animations (Human or Bike)
    if (hasBike && bikeMixer) {
        bikeMixer.update(delta);
    } else if (playerMesh && mixer) {
        mixer.update(delta);
    }

    updateUI();

    if (isPaused) return;

    beaconMesh.material.opacity = 0.5 + Math.sin(clock.elapsedTime * 4) * 0.2;

    if (gameActive) {
        if (isTimerRunning) timeLeft -= delta;
        if (drinkTimer > 0) drinkTimer -= delta;
        spawnTimer += delta;
        if (spawnTimer > POWERUP_SPAWN_RATE) {
            spawnPowerup();
            spawnTimer = 0;
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

    if (gameActive) {
        for (let i = powerups.length - 1; i >= 0; i--) {
            const p = powerups[i];
            // ... inside the powerups loop
            if (p.userData.type !== 'bike') {
                p.rotation.y += delta; 
            }
            
            if (p.userData.active && playerGroup.position.distanceTo(p.position) < 2.5) {
                if (p.userData.type === 'bike') {
                    hasBike = true;
                } else if (p.userData.type === 'drink') {
                    drinkTimer = DRINK_DURATION;
                } else if (p.userData.type === 'armor_tee') {
                    armor += 2; 
                } else if (p.userData.type === 'armor_belt') {
                    armor += 1; 
                }
                
                scene.remove(p);
                p.userData.active = false;
                powerups.splice(i, 1);
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
            if (keys.space && isGrounded && !jumpLocked) {
                verticalVelocity = JUMP_FORCE;
                isGrounded = false;
                jumpLocked = true; 
                
                if (animationsMap.has('Jump')) {
                    const jumpAction = animationsMap.get('Jump');
                    jumpAction.reset().setLoop(THREE.LoopOnce).play();
                    jumpAction.clampWhenFinished = true;
                    jumpAction.timeScale = 1.3; 
                    if (currentAction && currentAction !== jumpAction) {
                        currentAction.fadeOut(0.2);
                    }
                    currentAction = jumpAction;
                }
            }

            // 3. MOVEMENT
            if (forward !== 0) {
                let currentSpeed = BASE_SPEED;
                if (hasBike) currentSpeed *= BIKE_MULTIPLIER;
                if (drinkTimer > 0) currentSpeed *= DRINK_MULTIPLIER;

                const dirX = Math.sin(cameraAngle);
                const dirZ = Math.cos(cameraAngle);
                const moveVec = new THREE.Vector3(dirX * forward, 0, dirZ * forward).normalize();

                if (canMove(playerGroup.position, moveVec)) {
                    playerGroup.position.x += moveVec.x * currentSpeed * delta;
                    playerGroup.position.z += moveVec.z * currentSpeed * delta;
                }

                const targetRotation = cameraAngle + (forward > 0 ? 0 : Math.PI); 
                let rotDiff = targetRotation - playerMesh.rotation.y;
                while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
                while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
                
                const newRot = playerMesh.rotation.y + rotDiff * 0.1;
                playerMesh.rotation.y = newRot;

                // Add + Math.PI/2 (90 deg) or - Math.PI/2 (-90 deg) depending on the model
                if (playerBikeMesh) playerBikeMesh.rotation.y = newRot + (Math.PI / 2);
                
                // HUMAN ANIMATION (Run)
                if (!hasBike && isGrounded && currentAction !== animationsMap.get('Run')) {
                    const run = animationsMap.get('Run');
                    if (run) {
                        run.reset().fadeIn(0.2).play();
                        if (currentAction) currentAction.fadeOut(0.2);
                        currentAction = run;
                    }
                }
                
                // HUMAN ANIMATION SPEED
                if (!hasBike && isGrounded && currentAction === animationsMap.get('Run')) {
                    currentAction.timeScale = (currentSpeed / BASE_SPEED) * 1.2; 
                }

                // BIKE ANIMATION: PLAY ALL WHEN MOVING
                if (hasBike && bikeActions.length > 0) {
                bikeActions.forEach(action => {
                    action.paused = false; // Unpause
                    action.play();         // Ensure it's active
                 });
            }                  

            } else {
                // IDLE STATE
                
                // HUMAN ANIMATION (Idle)
                if (!hasBike && isGrounded && currentAction !== animationsMap.get('Idle')) {
                    const idle = animationsMap.get('Idle');
                    if (idle) {
                        idle.reset().fadeIn(0.2).play();
                        if (currentAction) currentAction.fadeOut(0.2);
                        currentAction = idle;
                        currentAction.timeScale = 1.0;
                    }
                }

                // BIKE ANIMATION: STOP ALL WHEN IDLE
                if (hasBike && bikeActions.length > 0) {
                bikeActions.forEach(action => {
                    action.paused = true; // Freeze exactly where it is
                });
            }
            }

            // 4. PHYSICS (Gravity)
            verticalVelocity += GRAVITY * delta; 
            playerGroup.position.y += verticalVelocity * delta;

            raycaster.set(playerGroup.position.clone().add(new THREE.Vector3(0, 5, 0)), downVector);
            const groundHits = raycaster.intersectObjects(colliderMeshes, false);

            if (groundHits.length > 0) {
                const hitY = groundHits[0].point.y;
                const distToFloor = playerGroup.position.y - hitY;

                if (verticalVelocity <= 0 && distToFloor < 0.5) {
                    playerGroup.position.y = hitY; 
                    verticalVelocity = 0;
                    isGrounded = true;
                } 
                else if (isGrounded && distToFloor < 1.5) {
                    playerGroup.position.y = THREE.MathUtils.lerp(playerGroup.position.y, hitY, 15 * delta);
                    verticalVelocity = 0; 
                }
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

            arrowMesh.lookAt(beaconGroup.position.x, 4, beaconGroup.position.z);
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
    
    // RENDER WITH COMPOSER (Instead of renderer)
    composer.render();
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

    // UPDATE BOKEH FOCUS (Keep player sharp)
    if (playerGroup) {
         const distToCam = camera.position.distanceTo(playerGroup.position);
         bokehPass.uniforms['focus'].value = distToCam;
      }
 }

animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight); // <--- IMPORTANT ADDITION
    
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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

window.switchMap = () => {
    // 1. Find where we are in the list
    let currentIndex = mapList.indexOf(currentMapName);
    
    // 2. Move to next one (loop back to 0 if at end)
    let nextIndex = (currentIndex + 1) % mapList.length;
    
    // 3. Set and Load
    currentMapName = mapList[nextIndex];
    loadLevel(currentMapName);
    
    if (document.activeElement) document.activeElement.blur();
};