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
    display: none; /* Hidden initially, shown when loading map */
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: #111; color: #fff; 
    justify-content: center; align-items: center; 
    font-family: 'Courier New', Courier, monospace; 
    z-index: 9999; flex-direction: column; text-align: center;
`;
loadingScreen.innerHTML = `
    <h1 style="font-size: 40px; margin-bottom: 20px; color: #ffff00; text-shadow: 2px 2px #000;">LOADING...</h1>
    <div style="font-size: 14px; opacity: 0.7;">PREPARING SECTOR</div>
`;
document.body.appendChild(loadingScreen);

// --- MENU FUNCTIONS ---
window.showMapSelection = () => {
    document.getElementById('menu-start').style.display = 'none';
    document.getElementById('map-selection').style.display = 'flex';
};

window.backToMenu = () => {
    document.getElementById('map-selection').style.display = 'none';
    document.getElementById('menu-start').style.display = 'block';
};

window.showHighScores = () => {
    alert("HIGH SCORES COMING SOON...");
};

window.selectMap = (mapName) => {
    // 1. Hide Menu
    document.getElementById('main-menu').style.display = 'none';
    
    // 2. Show HUD & Controls
    document.getElementById('ui-container').style.display = 'block';
    document.getElementById('mobile-controls').style.display = 'block';
    
    // 3. Start Game
    currentMapName = mapName;
    gameActive = true;
    isTimerRunning = true;
    timeLeft = START_TIME;
    score = 0;
    armor = 0;
    isBusted = false;
    
    loadLevel(currentMapName);
};

// --- MOBILE CONTROLS SETUP ---
let joystickInput = { x: 1, y: 1 };
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
const keys = { w: false, a: false, s: false, d: false, space: false, k: false };
const START_TIME = 90.0;    
const TIME_BONUS = 30.0;    
const BASE_SPEED = 20.0; 
const BIKE_MULTIPLIER = 1.8; 
const DRINK_MULTIPLIER = 1.4; 
const DRINK_DURATION = 15.0;
const POWERUP_SPAWN_RATE = 5.0; 

// MAP & AI CONFIG
const MAP_LIMIT = 4000;          
const ENEMY_RUN_SPEED = 14.0;      // Was 21.0 (Reduced by ~30%)
const ENEMY_WALK_SPEED = 5.0;      // Was 8.0  (Slower patrol)
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
let isTimerRunning = false;
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
let powerups = []; 

// Templates
let bikeTemplate = null; 
let drinkTemplate = null;
let lionTeeTemplate = null;      
let lionTeeGreyTemplate = null;
let beltTemplate = null; 
let policeTemplate = null;       
let policeClips = null;          

// ACTIVE ENEMIES LIST
let activeEnemies = [];          

// MAP STATE
let currentMapName = 'shoreditch.glb'; 

//CUSTOMER MODEL
let customerMixer = null

//ROAD DATA
let roadMeshes = []; // Stores the hidden DATA_ROADS mesh

// BIKE MODEL VARIABLES
let playerBikeMesh = null;
let bikeMixer = null;
let bikeTimer = 0; // Timer for how long the bike lasts

// UI HELPERS
function updateUI() {
    const uiScore = document.getElementById('score');
    const uiTimer = document.getElementById('timer');
    const uiPause = document.getElementById('pause-screen'); 
    const uiGameOver = document.getElementById('game-over');
    const uiDrink = document.getElementById('status-drink');
    const uiBike = document.getElementById('status-bike');
    const uiDrinkTimer = document.getElementById('drink-timer');
    
    // Ensure warning UI is hidden if it exists
    //const warningUI = document.getElementById('zone-warning');
    //if (warningUI) warningUI.style.display = 'none';

    if(uiScore) {
        let wantedStars = "";
        if (score >= WANTED_LEVEL_2_SCORE) wantedStars = "★★";
        else if (score >= WANTED_LEVEL_1_SCORE) wantedStars = "★";
        uiScore.innerText = `Deliveries: ${score} | 🛡️ ${armor} ${wantedStars}`;
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
    
    if(uiGameOver) {
        if (!gameActive && timeLeft <= 0 || isBusted) {
            uiGameOver.style.display = "block";
            if (isBusted) {
                uiGameOver.innerText = "BUSTED";
                uiGameOver.style.color = "#0088ff"; 
            } else {
                uiGameOver.innerText = "SHIFT ENDED";
                uiGameOver.style.color = "#ff3333";
            }
        } else {
            uiGameOver.style.display = "none";
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
    focus: 10.0,       
    aperture: 0.00002, 
    maxblur: 0.01,     
    width: window.innerWidth,
    height: window.innerHeight
});
composer.addPass(bokehPass);

const outputPass = new OutputPass();
composer.addPass(outputPass);

// --- DRACO LOADER SETUP ---
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');

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
loader.setDRACOLoader(dracoLoader);

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

// OLD BEACON CODE
//const beaconMesh = new THREE.Mesh(
//    new THREE.CylinderGeometry(2, 2, 80, 16), 
//    new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.5 })
//);
//beaconMesh.position.y = 40; 
//beaconGroup.add(beaconMesh);

// BEACON (CUSTOMER LOADER)
loader.load('customer.glb', (gltf) => {
    const customerModel = gltf.scene;
    
    // Adjust scale to match your game's scale (Player is approx 2.0)
    customerModel.scale.set(5.0, 5.0, 5.0); 

    customerModel.traverse((o) => {
        if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
        }
    });

    beaconGroup.add(customerModel);

    // Setup Animation
    customerMixer = new THREE.AnimationMixer(customerModel);
    const idleClip = THREE.AnimationClip.findByName(gltf.animations, 'Idle');
    
    if (idleClip) {
        customerMixer.clipAction(idleClip).play();
    } else {
        console.warn('Idle animation not found in customer.glb');
    }

}, undefined, (err) => console.error("Customer Load Error:", err));

// BEACON LIGHT CODE
//const beaconLight = new THREE.PointLight(0x00ff00, 800, 100);
//beaconLight.position.y = 10;
//beaconGroup.add(beaconLight);

// --- BIKE PLAYER MODEL LOADER ---
loader.load('playerbike.glb', (gltf) => {
    playerBikeMesh = gltf.scene;
    playerBikeMesh.scale.set(2.0, 2.0, 2.0);
    // Note: Rotation is handled in animate()
    playerBikeMesh.visible = false;      

    playerBikeMesh.traverse(o => { 
        if (o.isMesh) { 
            o.castShadow = true; 
            o.receiveShadow = true; 
            
            // MATERIAL FIXES (Prevent black model)
            if (o.material) {
                o.material.metalness = 0.0; 
                o.material.roughness = 0.8; 
                if (o.material.color) o.material.color.set(0xffffff);
            }
        } 
    });

    playerGroup.add(playerBikeMesh);

    // SETUP ANIMATIONS: Play ALL clips found in the file simultaneously
    bikeMixer = new THREE.AnimationMixer(playerBikeMesh);
    
    if (gltf.animations.length > 0) {
        gltf.animations.forEach((clip) => {
            const action = bikeMixer.clipAction(clip);
            action.play();
        });
        console.log(`Playing ${gltf.animations.length} bike animations.`);
    } else {
        console.warn("No animations found in playerbike.glb");
    }

}, undefined, (err) => console.error("Player Bike Error:", err));

// ARROW
const arrowMesh = new THREE.Mesh(
    new THREE.ConeGeometry(0.5, 1.5, 8),
    new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.8 }) 
);
arrowMesh.geometry.rotateX(Math.PI / 2); 
arrowMesh.position.y = 6; 
playerGroup.add(arrowMesh);

// Helper to check if an object or ANY of its parents has a specific name (Case-Insensitive)
function isDescendantOf(child, nameIdentifier) {
    let curr = child;
    const searchStr = nameIdentifier.toLowerCase();
    while (curr) {
        if (curr.name && curr.name.toLowerCase().includes(searchStr)) return true;
        curr = curr.parent;
    }
    return false;
}

// --- MAP LOADER FUNCTION ---
function loadLevel(mapName) {
    roadMeshes = [];
    console.log("Loading Map:", mapName);
    document.getElementById('loading-screen').style.display = 'flex';
    
    while(cityGroup.children.length > 0){ cityGroup.remove(cityGroup.children[0]); }
    colliderMeshes = [];
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
                // 1. Identify Road Data (Case-Insensitive)
                const isRoad = isDescendantOf(child, 'DATA_ROADS');

                if (isRoad) {
                    console.log("✅ Road Detected & Moved Underground:", child.name);
                    
                    // NUCLEAR OPTION: Move road data deep underground
                    child.position.y = -500; 
                    child.updateMatrix(); 
                    
                    // Force DoubleSide so Raycaster always hits it
                    if(!child.material) child.material = new THREE.MeshBasicMaterial();
                    child.material.side = THREE.DoubleSide;
                    
                    // Keep visible for Raycaster, but hide from Camera
                    child.visible = true; 
                    if (child.material) child.material.visible = false;
                    
                    roadMeshes.push(child);
                    // Do NOT add to colliderMeshes
                } 
                // 2. Handle Borders
                else if (child.name.toLowerCase().includes("border")) {
                    child.visible = false;       
                    colliderMeshes.push(child);  
                } 
                // 3. Handle Regular City Geometry
                else if (child.name !== "IGNORE_ME") {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    child.name = "CITY_MESH"; 
                    colliderMeshes.push(child);
                    
                    if (child.material) {
                        child.material.roughness = 0.9;
                        child.material.metalness = 0.1;
                        child.material.side = THREE.DoubleSide; 
                    }
                }
            }
        });
        
       // ... inside loadLevel, replacing the spawn attempts section ...

        cityGroup.add(map);
        cityGroup.updateMatrixWorld(true);

        // Attempt 1: Ideal conditions (Roads, away from center)
        console.log("Attempting Spawn 1: Strict Roads, Outer Ring");
        let startPos = getAnywhereSpawnPoint(new THREE.Vector3(0,0,0), 500, 3000);
        
        // Attempt 2: Relaxed conditions (Roads, anywhere on map)
        if (!startPos) {
            console.log("⚠️ Spawn 1 failed. Retrying Spawn 2: Strict Roads, Whole Map");
            startPos = getAnywhereSpawnPoint(new THREE.Vector3(0,0,0), 0, 3000);
        }

        // Attempt 3: EMERGENCY MODE (Ignore Road Data entirely)
        if (!startPos) {
            console.warn("⚠️ All Road Spawns Failed. EMERGENCY SPAWN: Dropping on any floor.");
            startPos = getAnywhereSpawnPoint(new THREE.Vector3(0,0,0), 0, 3000, true); 
        }

        if (startPos) {
            console.log("✅ Spawn Success at:", startPos);
            playerGroup.position.copy(startPos);
            playerGroup.position.y += 2.0; 
            verticalVelocity = 0; 
        } else {
            console.error("CRITICAL: No spawn point found anywhere. Player may fall.");
            playerGroup.position.set(0, 30, 0); 
        }

        
        spawnBeacon();
        spawnPowerup(); 
        
        document.getElementById('loading-screen').style.display = 'none';

    }, undefined, (err) => {
        console.error("Map Error:", err);
        alert("Could not load map: " + mapName);
        document.getElementById('loading-screen').style.display = 'none';
    });
}

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
    lionTeeTemplate.scale.set(1.5, 1.5, 1.5); 
    lionTeeTemplate.traverse(o => { if(o.isMesh) { o.castShadow = true; o.receiveShadow = true; }});
});

loader.load('lionteegrey.glb', (gltf) => {
    lionTeeGreyTemplate = gltf.scene;
    lionTeeGreyTemplate.scale.set(1.5, 1.5, 1.5);
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

function getAnywhereSpawnPoint(centerPos, minRadius, maxRadius, ignoreRoads = false) {
    const maxTries = 50; 
    const useRoadData = roadMeshes.length > 0 && !ignoreRoads;
    
    // We check against EVERYTHING: Buildings, Floor, and the Underground Road
    const spawnCheckList = useRoadData ? [...colliderMeshes, ...roadMeshes] : colliderMeshes;

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
        
        const intersects = raycaster.intersectObjects(spawnCheckList, false);
        
        if (intersects.length > 0) {
            if (useRoadData) {
                let hitRoad = false;
                let hitRoof = false;
                let groundHeight = null;

                for (let hit of intersects) {
                    // 1. Did we hit the underground road?
                    if (roadMeshes.includes(hit.object)) {
                        hitRoad = true;
                    } 
                    // 2. Did we hit a Roof? (Increased threshold to 50 to catch high floors)
                    else if (hit.point.y > 50) {
                        hitRoof = true;
                        break; 
                    }
                    // 3. Did we hit the Floor? (Widened window to -50 to 50)
                    else if (hit.point.y > -50 && hit.point.y < 50) {
                        groundHeight = hit.point.y;
                    }
                }

                if (hitRoad && !hitRoof && groundHeight !== null) {
                    return new THREE.Vector3(testX, groundHeight + 0.5, testZ);
                }

            } else {
                // FALLBACK (Relaxed height check for non-road mode too)
                const hit = intersects[0];
                if (hit.point.y > -50 && hit.point.y < 50) {
                    return new THREE.Vector3(testX, hit.point.y + 2.0, testZ);
                }
            }
        } 
    }
    
    if (useRoadData) console.warn(`Spawn failed in ${minRadius}-${maxRadius} (Strict Road Mode) - Floor likely missing or too high`);
    return null; 
}

function spawnBeacon() {
    // FIX: Reduced max radius from 3000 to 2000 to keep it safe
    let pos = getAnywhereSpawnPoint(playerGroup.position, 150, 2000);
    
    if (pos) {
        beaconGroup.position.copy(pos);
    } else {
        console.log("Could not find far spawn, trying closer...");
        // Fallback radius
        let closePos = getAnywhereSpawnPoint(playerGroup.position, 50, 500);
        if (closePos) {
             beaconGroup.position.copy(closePos);
        } else {
             // Ultimate fallback
             beaconGroup.position.set(0, 0, 0);
        }
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
        let pos = getAnywhereSpawnPoint(beaconGroup.position, 10, 80);
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
    mesh.scale.set(4.5, 4.5, 4.5); 
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
    
    // NEW: Spawn anywhere on the map (Radius 100 to 3000 from center)
    let pos = getAnywhereSpawnPoint(new THREE.Vector3(0,0,0), 100, 3000);
    
    if (pos) {
        mesh.position.copy(pos);
    } else {
        // Fallback: If random spawn fails, put them at 0,0
        mesh.position.set(0, 0, 0);
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
    let pos = getAnywhereSpawnPoint(new THREE.Vector3(0,0,0), 0, MAP_LIMIT * 0.8);
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

    if (type === 'bike') {
        if (bikeTemplate) group.add(bikeTemplate.clone());
        else {
            // FALLBACK GEOMETRY
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(2,1,0.5), new THREE.MeshBasicMaterial({color: 0x32CD32}));
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
    
    const laser = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), new THREE.Vector3(0,50,0)]),
        new THREE.LineBasicMaterial({ color: 0xFF0000 })
    );
    group.add(laser);

    scene.add(group);
    powerups.push(group);
}


// --- 6. GAME LOOP ---

let cameraAngle = 0;
const cameraRotationSpeed = 0.03;
const currentLookAt = new THREE.Vector3(0, 0, 0);

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

// --- UPDATED ANIMATE FUNCTION ---
function animate() {
    requestAnimationFrame(animate);
    
    const rawDelta = clock.getDelta();
    const delta = Math.min(rawDelta, 0.05);

    if (customerMixer) customerMixer.update(delta);

    updateUI();

    if (isPaused) return;

    if (gameActive) {
        if (isTimerRunning) timeLeft -= delta;
        if (drinkTimer > 0) drinkTimer -= delta;
        if (bikeTimer > 0) {
            bikeTimer -= delta;
            if (bikeTimer <= 0) hasBike = false;
        }
        
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

    // --- POWERUP CHECK ---
    if (gameActive && playerGroup) {
        powerups.forEach((p) => {
            if (p.visible && playerGroup.position.distanceTo(p.position) < 3.0) {
                p.visible = false; 
                p.position.y = -100; 
                if (p.userData.type === 'bike') {
                    hasBike = true;
                    bikeTimer = 30.0; 
                    timeLeft += 10;
                } 
                else if (p.userData.type === 'drink') drinkTimer = 15.0;
                else if (p.userData.type.includes('armor')) armor++;
            }
        });
    }

    // --- MODEL SWAP ---
    if (playerMesh && playerBikeMesh) {
        if (hasBike) {
            playerMesh.visible = false;
            playerBikeMesh.visible = true;
            if (bikeMixer) bikeMixer.update(delta);
        } else {
            playerMesh.visible = true;
            playerBikeMesh.visible = false;
            if (mixer) mixer.update(delta);
        }
    }

    // --- AI LOGIC (Keep existing) ---
    if (gameActive) {
        activeEnemies.forEach((enemy) => {
             if (enemy.mixer) enemy.mixer.update(delta);
             // ... [YOUR AI LOGIC HERE] ...
             // (Ensure you kept the AI code from previous steps)
        });
    }
    
    // --- PLAYER MOVEMENT ---
    if (gameActive && !isMapOpen) {
        let forward = 0;
        
        // KEYBOARD
        if (keys.w) forward = 1;
        if (keys.s) forward = -1;
        
        // JOYSTICK
        // FIX: Added 'deadzone' check (> 0.1) so he doesn't spin in circles
        if (Math.abs(joystickInput.y) > 0.1) {
            // FIX: Swap 1/-1 if controls were inverted. 
            // Trying "y > 0 ? 1 : -1" (Standard)
            forward = joystickInput.y > 0 ? 1 : -1; 
        }

        // TURN
        if (keys.a) cameraAngle += cameraRotationSpeed;
        if (keys.d) cameraAngle -= cameraRotationSpeed;
        if (Math.abs(joystickInput.x) > 0.1) {
             // FIX: Invert X multiplication if turning is backwards
             cameraAngle -= joystickInput.x * cameraRotationSpeed * 2.0; 
        }

        // JUMP
        if (keys.space && isGrounded && !jumpLocked) {
            verticalVelocity = JUMP_FORCE;
            isGrounded = false;
            jumpLocked = true;
            if (!hasBike && animationsMap.has('Jump')) {
                 const jumpAction = animationsMap.get('Jump');
                 jumpAction.reset().setLoop(THREE.LoopOnce).play();
                 currentAction = jumpAction;
            }
        }

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

            // ROTATION LOGIC
            // FIX: If player was backwards, we adjust the target rotation offset here
            const targetRotation = cameraAngle + (forward > 0 ? 0 : Math.PI); 
            
            let rotDiff = targetRotation - playerGroup.rotation.y; 
            while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
            while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
            const smoothRot = playerGroup.rotation.y + (rotDiff * 0.1);
            
            // Apply smoothed rotation to the GROUP
            playerGroup.rotation.y = smoothRot;

            // FIX: ROTATE MODELS INSIDE THE GROUP
            // Reset local rotations
            if(playerMesh) playerMesh.rotation.y = Math.PI; // Human usually needs 180 flip
            
            // FIX: BIKE ROTATION (Re-apply 90 degree offset)
            // Try -Math.PI/2 if it's 90 degrees wrong the other way
            if(playerBikeMesh) playerBikeMesh.rotation.y = Math.PI + (Math.PI / 2); 

            // Run Animation
            if (!hasBike && isGrounded && currentAction !== animationsMap.get('Run')) {
                const run = animationsMap.get('Run');
                if (run) {
                    run.reset().play();
                    if (currentAction) currentAction.stop();
                    currentAction = run;
                }
            }
        } else {
            // Idle Animation
            if (!hasBike && isGrounded && currentAction !== animationsMap.get('Idle')) {
                const idle = animationsMap.get('Idle');
                if (idle) {
                    idle.reset().play();
                    if (currentAction) currentAction.stop();
                    currentAction = idle;
                }
            }
        }

        // GRAVITY
        verticalVelocity += GRAVITY * delta; 
        playerGroup.position.y += verticalVelocity * delta;

        // FLOOR COLLISION
        raycaster.set(playerGroup.position.clone().add(new THREE.Vector3(0, 5, 0)), downVector);
        const groundHits = raycaster.intersectObjects(colliderMeshes, false);
        if (groundHits.length > 0) {
            const hitY = groundHits[0].point.y;
            if (playerGroup.position.y - hitY < 0.5 && verticalVelocity <= 0) {
                playerGroup.position.y = hitY;
                verticalVelocity = 0;
                isGrounded = true;
            } else if (isGrounded && playerGroup.position.y - hitY < 1.5) {
                playerGroup.position.y = THREE.MathUtils.lerp(playerGroup.position.y, hitY, 15 * delta);
            }
        }
        
        // CHECK DELIVERY
        if (playerGroup.position.distanceTo(beaconGroup.position) < 10) { 
             score++;
             timeLeft += 60;
             spawnBeacon();
        }
    }

    // --- CAMERA & FOG ---
    let targetPos, targetLook;
    let targetFogNear, targetFogFar;
    const distFromCenter = playerGroup.position.length();
    const warningUI = document.getElementById('zone-warning');

    if (isMapOpen) {
        targetPos = playerGroup.position.clone().add(new THREE.Vector3(0, 200, 0)); 
        targetLook = playerGroup.position.clone();
        targetFogNear = 150; targetFogFar = 800;
        beaconGroup.scale.set(4, 4, 4); 
        arrowMesh.scale.set(4, 4, 4);
        if (warningUI) warningUI.style.display = 'none';
    } else {
        const offset = new THREE.Vector3(0, 6, -10).applyAxisAngle(new THREE.Vector3(0,1,0), cameraAngle);
        targetPos = playerGroup.position.clone().add(offset);
        targetLook = playerGroup.position.clone().add(new THREE.Vector3(0, 2, 0));
        beaconGroup.scale.set(1, 1, 1);
        arrowMesh.scale.set(1, 1, 1);

        const safeRadius = 3000;
        if (distFromCenter > safeRadius) {
            const dangerFactor = Math.min((distFromCenter - safeRadius) / (MAP_LIMIT - safeRadius), 1.0);
            targetFogNear = THREE.MathUtils.lerp(1500, 50, dangerFactor);
            targetFogFar  = THREE.MathUtils.lerp(3000, 500, dangerFactor);
            if (warningUI) warningUI.style.display = dangerFactor > 0.5 ? 'block' : 'none';
        } else {
            targetFogNear = 1500; targetFogFar = 3000;
            if (warningUI) warningUI.style.display = 'none';
        }
    }

    camera.position.lerp(targetPos, 0.1);
    currentLookAt.lerp(targetLook, 0.1);
    camera.lookAt(currentLookAt);
    
    scene.fog.near = THREE.MathUtils.lerp(scene.fog.near, targetFogNear, 0.05);
    scene.fog.far = THREE.MathUtils.lerp(scene.fog.far, targetFogFar, 0.05);

    if (playerGroup) {
        bokehPass.uniforms['focus'].value = camera.position.distanceTo(playerGroup.position);
    }

    composer.render();
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight); // <--- Add this
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

window.switchMap = () => {
    // Define your list of maps
    const mapList = ['shoreditch.glb', 'archway.glb', 'carnabyst.glb'];
    let currentIndex = mapList.indexOf(currentMapName);
    let nextIndex = (currentIndex + 1) % mapList.length;
    currentMapName = mapList[nextIndex];
    loadLevel(currentMapName);
    
    if (document.activeElement) document.activeElement.blur();
};