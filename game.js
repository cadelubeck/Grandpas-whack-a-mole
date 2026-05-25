const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const menuScreen = document.getElementById('menuScreen');
const messageScreen = document.getElementById('messageScreen');
const messageTitle = document.getElementById('messageTitle');
const messageText = document.getElementById('messageText');
const startButton = document.getElementById('startButton');
const continueButton = document.getElementById('continueButton');
const touchControls = document.getElementById('touchControls');

const BG_IMAGE = new Image();
BG_IMAGE.src = '2725145055771000984.jpg.jpeg';
let bgReady = false;
BG_IMAGE.onload = () => { bgReady = true; };

const LEVELS = [
    { goal: 10, visibleTime: 2500, spawnInterval: 2000, simultaneous: 2, timeLimit: 35 },
    { goal: 20, visibleTime: 2000, spawnInterval: 1500, simultaneous: 3, timeLimit: 40 },
    { goal: 35, visibleTime: 1500, spawnInterval: 900, simultaneous: 4, timeLimit: 45 },
    { goal: 50, visibleTime: 1000, spawnInterval: 600, simultaneous: 5, timeLimit: 50 }
];
const DYNAMITE_RADIUS = 90 * 4;
const DYNAMITE_COOLDOWN = 0.4;

const dirtSpots = [
    { x: 220, y: 260 },
    { x: 520, y: 270 },
    { x: 900, y: 270 },
    { x: 300, y: 430 },
    { x: 670, y: 450 },
    { x: 1080, y: 390 },
    { x: 240, y: 600 },
    { x: 560, y: 620 },
    { x: 930, y: 620 }
];

const player = {
    x: 640,
    y: 540,
    speed: 420,
    width: 42,
    height: 48,
    direction: 'down',
    attacking: false,
    attackTimer: 0,
    attackCooldown: 0,
    attackHit: false,
    combo: 0,
    dynamite: 0,
    pendingDynamite: false,
};

const state = {
    screen: 'menu',
    levelIndex: 0,
    score: 0,
    hits: 0,
    misses: 0,
    timeLeft: LEVELS[0].timeLimit,
    nextSpawn: 0,
    activeMoles: [],
    explosions: [],
    lastTime: 0,
    pendingMessage: null,
};

const keys = {
    ArrowUp: false,
    ArrowDown: false,
    ArrowLeft: false,
    ArrowRight: false,
    Space: false,
    ShiftLeft: false,
    ShiftRight: false,
};

function resetLevel() {
    const cfg = LEVELS[state.levelIndex];
    state.score = 0;
    state.hits = 0;
    state.misses = 0;
    state.timeLeft = cfg.timeLimit;
    state.nextSpawn = 0;
    state.activeMoles = [];
    state.explosions = [];
    player.x = 640;
    player.y = 540;
    player.attacking = false;
    player.attackTimer = 0;
    player.attackCooldown = 0;
    player.combo = 0;
    player.dynamite = 0;
}

function startGame() {
    state.screen = 'playing';
    state.levelIndex = 0;
    resetLevel();
    menuScreen.classList.add('hidden');
    messageScreen.classList.add('hidden');
    touchControls.classList.remove('hidden');
    state.lastTime = performance.now();
    requestAnimationFrame(gameLoop);
}

function showMessage(title, text, buttonText = 'Continue') {
    touchControls.classList.add('hidden');
    state.screen = 'message';
    messageTitle.textContent = title;
    messageText.textContent = text;
    continueButton.textContent = buttonText;
    menuScreen.classList.add('hidden');
    messageScreen.classList.remove('hidden');
}

function nextLevel() {
    state.levelIndex += 1;
    if (state.levelIndex >= LEVELS.length) {
        showMessage('Victory!', `You smashed ${state.score} moles and cleared all 4 levels.`, 'Play Again');
        state.screen = 'victory';
        return;
    }
    resetLevel();
    state.screen = 'playing';
    messageScreen.classList.add('hidden');
    touchControls.classList.remove('hidden');
    requestAnimationFrame(gameLoop);
}

function failLevel() {
    showMessage('Game Over', `You missed too many moles or ran out of time.
Level reached: ${state.levelIndex + 1}
Score: ${state.score}`, 'Retry');
    state.screen = 'gameover';
}

function createMole() {
    const availableSpots = dirtSpots.filter(spot => !state.activeMoles.some(m => m.spot === spot));
    if (!availableSpots.length) return;
    const spot = availableSpots[Math.floor(Math.random() * availableSpots.length)];
    const cfg = LEVELS[state.levelIndex];
    state.activeMoles.push({
        spot,
        x: spot.x,
        y: spot.y,
        active: true,
        spawnTime: performance.now(),
        visibleTime: cfg.visibleTime,
        popped: true,
        hit: false,
    });
}

function getDistance(a, b, c, d) {
    const dx = a - c;
    const dy = b - d;
    return Math.sqrt(dx * dx + dy * dy);
}

function getMoleDrawPosition(mole) {
    const progress = (performance.now() - mole.spawnTime) / mole.visibleTime;
    const rise = Math.sin(Math.min(progress, 1) * Math.PI) * 20;
    return { x: mole.x, y: mole.y - rise };
}

function resolveMoleHit(mole) {
    mole.active = false;
    mole.hit = true;
    state.score += 1;
    state.hits += 1;
    player.combo += 1;
    if (player.combo % 5 === 0) {
        player.dynamite = Math.min(3, player.dynamite + 1);
    }
    playBeep(600, 0.08, 'square');
}

function recordMiss() {
    state.misses += 1;
    player.combo = 0;
}

function recordExpiredMole() {
    state.misses += 1;
}

function triggerExplosion() {
    if (player.dynamite <= 0 || state.pendingMessage) return;
    player.dynamite -= 1;
    state.explosions.push({
        x: player.x,
        y: player.y,
        radius: 0,
        startTime: performance.now(),
        duration: 520,
    });
    playBeep(120, 0.2, 'triangle');
}

function updateExplosions(dt) {
    state.explosions = state.explosions.filter(explosion => {
        const elapsed = performance.now() - explosion.startTime;
        if (elapsed >= explosion.duration) return false;
        explosion.radius = DYNAMITE_RADIUS * Math.min(1, elapsed / explosion.duration);
        return true;
    });
}

function applyExplosionDamage() {
    const explosion = state.explosions[state.explosions.length - 1];
    if (!explosion) return;
    state.activeMoles.forEach(mole => {
        if (!mole.active) return;
        const drawPos = getMoleDrawPosition(mole);
        const dist = getDistance(explosion.x, explosion.y, drawPos.x, drawPos.y);
        if (dist <= DYNAMITE_RADIUS) {
            resolveMoleHit(mole);
        }
    });
}

function playBeep(freq, duration, type = 'sine') {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
    oscillator.connect(gain);
    gain.connect(audioCtx.destination);
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + duration);
    oscillator.onended = () => audioCtx.close();
}

function handleInput(dt) {
    const moving = keys.ArrowUp || keys.ArrowDown || keys.ArrowLeft || keys.ArrowRight;
    if (keys.ArrowUp) {
        player.y -= player.speed * dt;
        player.direction = 'up';
    }
    if (keys.ArrowDown) {
        player.y += player.speed * dt;
        player.direction = 'down';
    }
    if (keys.ArrowLeft) {
        player.x -= player.speed * dt;
        player.direction = 'left';
    }
    if (keys.ArrowRight) {
        player.x += player.speed * dt;
        player.direction = 'right';
    }
    player.x = Math.min(Math.max(player.width / 2, player.x), canvas.width - player.width / 2);
    player.y = Math.min(Math.max(player.height / 2, player.y), canvas.height - player.height / 2);

    if ((keys.ShiftLeft || keys.ShiftRight) && player.attackCooldown <= 0) {
        triggerExplosion();
        player.attackCooldown = DYNAMITE_COOLDOWN;
    }

    if (keys.Space && player.attackCooldown <= 0 && !player.attacking) {
        player.attacking = true;
        player.attackTimer = 0;
        player.attackHit = false;
        player.attackCooldown = 0.35;
    }
}

function updateMoles(dt) {
    const now = performance.now();
    const cfg = LEVELS[state.levelIndex];
    state.activeMoles = state.activeMoles.filter(mole => {
        if (!mole.active) return false;
        if (now - mole.spawnTime > mole.visibleTime) {
            recordExpiredMole();
            return false;
        }
        return true;
    });

    const liveCount = state.activeMoles.length;
    if (now >= state.nextSpawn && liveCount < cfg.simultaneous) {
        const spawnCount = Math.min(2, cfg.simultaneous - liveCount);
        for (let i = 0; i < spawnCount; i += 1) {
            createMole();
        }
        state.nextSpawn = now + cfg.spawnInterval;
    }
}

function updateAttack(dt) {
    if (player.attacking) {
        player.attackTimer += dt;
        const attackBox = getAttackBox();
        let hitSomething = false;
        state.activeMoles.forEach(mole => {
            if (!mole.active) return;
            const drawPos = getMoleDrawPosition(mole);
            if (rectOverlap(attackBox, { x: drawPos.x - 22, y: drawPos.y - 24, width: 44, height: 48 })) {
                resolveMoleHit(mole);
                hitSomething = true;
            }
        });
        if (hitSomething) {
            player.attackHit = true;
        }
        if (player.attackTimer >= 0.16) {
            player.attacking = false;
            if (!player.attackHit) {
                recordMiss();
            }
            player.attackHit = false;
            player.attackTimer = 0;
        }
    }
}

function rectOverlap(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function getAttackBox() {
    const size = 92;
    const range = 60;
    const box = { x: player.x - size/2, y: player.y - size/2, width: size, height: size };
    if (player.direction === 'up') box.y = player.y - range - 10;
    if (player.direction === 'down') box.y = player.y + range - 10;
    if (player.direction === 'left') box.x = player.x - range - 10;
    if (player.direction === 'right') box.x = player.x + range - 10;
    return box;
}

function drawAttackIndicator() {
    const attackBox = getAttackBox();
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.fillRect(attackBox.x, attackBox.y, attackBox.width, attackBox.height);
    ctx.strokeRect(attackBox.x, attackBox.y, attackBox.width, attackBox.height);
    ctx.restore();
}

function gameLoop(time) {
    if (state.screen !== 'playing') return;
    const dt = Math.min(0.032, (time - state.lastTime) / 1000);
    state.lastTime = time;
    state.timeLeft -= dt;
    player.attackCooldown = Math.max(0, player.attackCooldown - dt);

    handleInput(dt);
    updateMoles(dt);
    updateAttack(dt);
    updateExplosions(dt);
    if (state.explosions.length) {
        applyExplosionDamage();
    }

    if (state.timeLeft <= 0) {
        failLevel();
        render();
        return;
    }
    if (state.hits >= LEVELS[state.levelIndex].goal) {
        const nextMessage = `Level ${state.levelIndex + 1} complete! Get ready for the next wave.`;
        showMessage('Level Complete', nextMessage, 'Next Level');
        return;
    }
    render();
    requestAnimationFrame(gameLoop);
}

function drawBackground() {
    if (bgReady) {
        ctx.drawImage(BG_IMAGE, 0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(245, 230, 210, 0.18)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
        ctx.fillStyle = '#4c5c49';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
}

function drawDirtSpots() {
    dirtSpots.forEach(spot => {
        ctx.save();
        ctx.translate(spot.x, spot.y);
        ctx.fillStyle = '#b34f3b';
        ctx.beginPath();
        ctx.ellipse(0, 0, 42, 22, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#7d2b1f';
        ctx.beginPath();
        ctx.ellipse(0, 6, 28, 12, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    });
}

function drawMoles() {
    state.activeMoles.forEach(mole => {
        const progress = (performance.now() - mole.spawnTime) / mole.visibleTime;
        const rise = Math.sin(Math.min(progress, 1) * Math.PI) * 20;
        ctx.save();
        ctx.translate(mole.x, mole.y - rise);
        ctx.fillStyle = '#5a3b28';
        ctx.beginPath();
        ctx.ellipse(0, 2, 30, 24, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(0, -22, 22, 18, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#351f12';
        ctx.beginPath();
        ctx.ellipse(-14, -30, 8, 10, 0, 0, Math.PI * 2);
        ctx.ellipse(14, -30, 8, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f0cfa0';
        ctx.beginPath();
        ctx.ellipse(-10, -18, 6, 8, 0, 0, Math.PI * 2);
        ctx.ellipse(10, -18, 6, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#111';
        ctx.beginPath();
        ctx.arc(-10, -18, 2.7, 0, Math.PI * 2);
        ctx.arc(10, -18, 2.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#e17b65';
        ctx.beginPath();
        ctx.ellipse(0, -8, 10, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#3c2419';
        ctx.beginPath();
        ctx.moveTo(-12, 0);
        ctx.quadraticCurveTo(0, 12, 12, 0);
        ctx.lineTo(12, 4);
        ctx.quadraticCurveTo(0, 18, -12, 4);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#23160d';
        ctx.beginPath();
        ctx.arc(-14, 10, 4, 0, Math.PI * 2);
        ctx.arc(14, 10, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#3c2419';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-4, -4);
        ctx.lineTo(-12, 2);
        ctx.moveTo(4, -4);
        ctx.lineTo(12, 2);
        ctx.stroke();
        ctx.restore();
    });
}

function drawPlayer() {
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.direction === 'left' ? -0.05 : player.direction === 'right' ? 0.05 : 0);
    const step = Math.sin(performance.now() / 180) * 2;

    // legs
    ctx.fillStyle = '#40332b';
    ctx.beginPath();
    ctx.moveTo(-12, 22);
    ctx.quadraticCurveTo(-16, 38, -10, 52);
    ctx.lineTo(-2, 52);
    ctx.lineTo(2, 34);
    ctx.lineTo(0, 24);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(12, 22);
    ctx.quadraticCurveTo(16, 38, 10, 52);
    ctx.lineTo(2, 52);
    ctx.lineTo(-2, 34);
    ctx.lineTo(0, 24);
    ctx.closePath();
    ctx.fill();

    // body and shirt
    ctx.fillStyle = '#2b4e3a';
    ctx.beginPath();
    ctx.moveTo(-18, 6);
    ctx.quadraticCurveTo(-28, 22, -20, 44);
    ctx.lineTo(20, 44);
    ctx.quadraticCurveTo(28, 22, 18, 6);
    ctx.closePath();
    ctx.fill();

    // arms
    ctx.fillStyle = '#2b4e3a';
    ctx.beginPath();
    ctx.ellipse(-24, 10, 8, 18, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(24, 10, 8, 18, -0.4, 0, Math.PI * 2);
    ctx.fill();

    // face and head
    ctx.fillStyle = '#ffe1b1';
    ctx.beginPath();
    ctx.arc(0, -18, 16, 0, Math.PI * 2);
    ctx.fill();

    // hair
    ctx.fillStyle = '#442b18';
    ctx.beginPath();
    ctx.arc(0, -28, 16, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(-16, -28, 32, 8);

    // eyes
    ctx.fillStyle = '#2b2b2b';
    ctx.beginPath();
    ctx.arc(-6, -22, 2.5, 0, Math.PI * 2);
    ctx.arc(6, -22, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // nose
    ctx.strokeStyle = '#8b5f44';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(0, -12);
    ctx.stroke();

    // mouth
    ctx.strokeStyle = '#c45a4f';
    ctx.beginPath();
    ctx.arc(0, -8, 5, 0, Math.PI);
    ctx.stroke();

    const t = Math.min(1, player.attackTimer / 0.16);
    const swing = player.attacking ? Math.sin(t * Math.PI) * 0.8 : 0;
    let baseAngle = player.direction === 'left' ? -0.8 : player.direction === 'right' ? 0.8 : player.direction === 'up' ? -1.5 : 0.4;
    const hammerAngle = baseAngle + swing * (player.direction === 'up' ? 0.6 : player.direction === 'down' ? -0.6 : player.direction === 'left' ? -0.6 : 0.6);

    ctx.save();
    ctx.translate(18, 6);
    ctx.rotate(hammerAngle);
    ctx.fillStyle = '#8b5f44';
    ctx.fillRect(0, -4, 34, 8);
    ctx.fillStyle = '#ffd96d';
    ctx.beginPath();
    ctx.moveTo(26, -14);
    ctx.lineTo(50, -10);
    ctx.lineTo(50, 10);
    ctx.lineTo(26, 14);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.restore();
}

function drawExplosions() {
    state.explosions.forEach(explosion => {
        const alpha = 0.6 - (explosion.radius / DYNAMITE_RADIUS) * 0.5;
        ctx.save();
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.fillStyle = '#ffd966';
        ctx.beginPath();
        ctx.arc(explosion.x, explosion.y, explosion.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    });
}

function drawHUD() {
    const cfg = LEVELS[state.levelIndex];
    ctx.save();
    ctx.fillStyle = 'rgba(5, 10, 12, 0.7)';
    ctx.fillRect(16, 16, 370, 110);
    ctx.fillStyle = '#f5f5f5';
    ctx.font = 'bold 22px Inter, sans-serif';
    ctx.fillText(`Level ${state.levelIndex + 1}`, 36, 44);
    ctx.fillText(`Score ${state.score}`, 192, 44);
    ctx.fillText(`Target ${cfg.goal}`, 36, 72);
    ctx.fillText(`Time ${Math.ceil(state.timeLeft)}`, 192, 72);
    ctx.fillText(`Combo x${player.combo}`, 36, 100);
    ctx.fillText(`Dynamite ${player.dynamite}`, 192, 100);
    ctx.restore();
}

function render() {
    drawBackground();
    drawDirtSpots();
    drawMoles();
    drawAttackIndicator();
    drawPlayer();
    drawExplosions();
    drawHUD();
}

window.addEventListener('keydown', event => {
    if (event.code in keys) {
        keys[event.code] = true;
        event.preventDefault();
    }
});
window.addEventListener('keyup', event => {
    if (event.code in keys) {
        keys[event.code] = false;
        event.preventDefault();
    }
});

startButton.addEventListener('click', startGame);
continueButton.addEventListener('click', () => {
    if (state.screen === 'victory' || state.screen === 'gameover') {
        startGame();
        return;
    }
    if (state.levelIndex < LEVELS.length - 1) {
        nextLevel();
    } else {
        startGame();
    }
});

function handleTouchButton(button) {
    const code = button.dataset.key;
    if (!code) return;
    const press = () => {
        keys[code] = true;
    };
    const release = () => {
        keys[code] = false;
    };
    button.addEventListener('pointerdown', event => {
        event.preventDefault();
        press();
    });
    button.addEventListener('pointerup', event => {
        event.preventDefault();
        release();
    });
    button.addEventListener('pointerleave', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
}

document.querySelectorAll('#touchControls .touch-btn').forEach(handleTouchButton);

window.addEventListener('pointerup', () => {
    Object.keys(keys).forEach(key => {
        keys[key] = false;
    });
});
window.addEventListener('pointercancel', () => {
    Object.keys(keys).forEach(key => {
        keys[key] = false;
    });
});

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        Object.keys(keys).forEach(key => {
            keys[key] = false;
        });
    }
});

render();
