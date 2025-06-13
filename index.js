import express from "express";
import puppeteer from "puppeteer";
import * as dotenv from "dotenv";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
app.use(express.json());

// Variables globales pour gérer la session
let currentBrowser = null;
let currentPage = null;
let solverPage = null;
let waitingForPhone = false;
let waitingForOTP = false;
let phoneNumber = '';
let otpCode = '';
let isProcessing = false;
let solvedCount = 0;
const MAX_SOLVED_PER_SESSION = 300;
const COOKIE_FILE = 'cookies.json';

// Configuration optimisée du navigateur
const BROWSER_CONFIG = {
    args: [
        "--disable-setuid-sandbox",
        "--no-sandbox",
        "--single-process",
        "--no-zygote",
        "--disable-dev-shm-usage",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-features=TranslateUI",
        "--disable-ipc-flooding-protection",
        "--disable-web-security",
        "--disable-features=VizDisplayCompositor",
        "--memory-pressure-off",
        "--max_old_space_size=4096"
    ],
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome-stable",
    headless: "new",
    timeout: 30000,
    defaultViewport: { width: 1280, height: 720 }
};

// Obtenir le chemin du répertoire actuel
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Cache pour les sélecteurs mis à jour
const SELECTORS = {
    loginButton: "button.w-53.py-3.px-6.bg-gradient-to-r.from-amber-400.to-amber-500.text-white.text-lg.font-bold.rounded-full.shadow-lg.mt-36",
    phoneInput: "input[placeholder='Nimushiremwo inomero ya terefone']",
    otpInput: "input[placeholder='OTP']",
    sendOtpButton: "button.w-full.py-2.bg-red-700.text-white.rounded-md.font-semibold.hover\\:bg-red-600.transition.duration-200",
    confirmButton: "button.w-full.py-2.bg-red-700.text-white.rounded-md.font-semibold.hover\\:bg-red-800.transition.duration-200",
    sudokuGrid: "div.grid.grid-cols-9.gap-0.border-4.border-black",
    sudokuCells: "div.grid.grid-cols-9.gap-0.border-4.border-black div.w-10.h-10",
    numberButtons: "div.flex.gap-2.mt-4 button",
    newGameButton: "button.py-2.px-4.bg-red-800.text-white.rounded-full.ml-5",
    solverInputs: "input.c",
    solverReset: "input[type='reset']",
    solverSolve: "input[value='Solve']",
    leaderboard: "div.mt-6.border.rounded-lg.p-4",
    myScore: "div.relative.z-10.bg-teal-800\\/70 span.text-white.ml-4"
};

// Routes API
app.get("/", (req, res) => {
    res.json({
        message: "Sudoku Solver API is running",
        endpoints: {
            start: "/start-sudoku - POST - Démarre le processus de résolution",
            phone: "/submit-phone - POST - Soumet le numéro de téléphone",
            otp: "/submit-otp - POST - Soumet le code OTP",
            status: "/status - GET - Vérifie le statut du processus"
        }
    });
});

app.get("/status", (req, res) => {
    res.json({
        isProcessing,
        waitingForPhone,
        waitingForOTP,
        hasBrowser: !!currentBrowser,
        hasPage: !!currentPage,
        solvedCount,
        maxPerSession: MAX_SOLVED_PER_SESSION
    });
});

app.post("/start-sudoku", async (req, res) => {
    if (isProcessing) {
        return res.status(400).json({
            success: false,
            error: "Le processus est déjà en cours"
        });
    }

    try {
        isProcessing = true;
        solvedCount = 0;
        console.log("🚀 Démarrage du solveur Sudoku...");
        
        solveSudokuProcess().catch(error => {
            console.error("Erreur dans le processus:", error);
            cleanup();
        });

        res.json({
            success: true,
            message: "Processus de résolution démarré"
        });
    } catch (error) {
        cleanup();
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post("/submit-phone", async (req, res) => {
    const { phone } = req.body;
    
    if (!waitingForPhone || !phone) {
        return res.status(400).json({
            success: false,
            error: waitingForPhone ? "Numéro de téléphone requis" : "Aucune demande de numéro en cours"
        });
    }

    phoneNumber = phone;
    waitingForPhone = false;
    
    res.json({
        success: true,
        message: "Numéro de téléphone reçu"
    });
});

app.post("/submit-otp", async (req, res) => {
    const { otp } = req.body;
    
    if (!waitingForOTP || !otp) {
        return res.status(400).json({
            success: false,
            error: waitingForOTP ? "Code OTP requis" : "Aucune demande d'OTP en cours"
        });
    }

    otpCode = otp;
    waitingForOTP = false;
    
    res.json({
        success: true,
        message: "Code OTP reçu"
    });
});

// Gestion des cookies optimisée
async function saveCookies(page) {
    try {
        const cookies = await page.cookies();
        fs.writeFileSync(path.join(__dirname, COOKIE_FILE), JSON.stringify(cookies, null, 2));
        console.log('🍪 Cookies sauvegardés');
    } catch (error) {
        console.error('Erreur sauvegarde cookies:', error.message);
    }
}

async function loadCookies(page) {
    try {
        const cookiePath = path.join(__dirname, COOKIE_FILE);
        if (fs.existsSync(cookiePath)) {
            const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
            await page.setCookie(...cookies);
            console.log('🍪 Cookies chargés');
            return true;
        }
        return false;
    } catch (error) {
        console.error('Erreur chargement cookies:', error.message);
        return false;
    }
}

// Fonction de nettoyage centralisée
function cleanup() {
    isProcessing = false;
    waitingForPhone = false;
    waitingForOTP = false;
    phoneNumber = '';
    otpCode = '';
}

// Fonction utilitaire pour attendre avec timeout
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Fonction pour attendre un élément avec retry
async function waitForElement(page, selector, timeout = 10000, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            await page.waitForSelector(selector, { timeout });
            return true;
        } catch (error) {
            console.log(`⚠ Tentative ${i + 1}/${retries} pour ${selector} échouée`);
            if (i === retries - 1) throw error;
            await sleep(1000);
        }
    }
    return false;
}

// Configuration des pages pour permettre les ressources nécessaires
function setupPageInterception(page, allowAll = false) {
    return page.setRequestInterception(true).then(() => {
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            const url = req.url();
            
            if (allowAll) {
                // Pour la page principale, on autorise tout sauf les images lourdes
                if (resourceType === 'image' && (url.includes('.jpg') || url.includes('.png') || url.includes('.gif'))) {
                    req.abort();
                } else {
                    req.continue();
                }
            } else {
                // Pour le solveur, on bloque toujours les ressources lourdes
                if (['image', 'media'].includes(resourceType)) {
                    req.abort();
                } else {
                    req.continue();
                }
            }
        });
    });
}

// Fonction pour vérifier le score optimisée
async function shouldContinueSolving() {
    try {
        console.log("🔍 Vérification des scores...");
        await currentPage.goto("https://sudoku.lumitelburundi.com", { waitUntil: "networkidle2", timeout: 20000 });
        await sleep(3000);

        const scores = await currentPage.evaluate((selectors) => {
            const leaderboard = document.querySelector(selectors.leaderboard);
            const myScoreElement = document.querySelector(selectors.myScore);
            
            let lastPlaceScore = null;
            let myScore = null;
            
            if (leaderboard) {
                const items = leaderboard.querySelectorAll('div.space-y-3 > div');
                if (items.length > 0) {
                    const lastItem = items[items.length - 1];
                    const scoreElement = lastItem.querySelector('span.text-lg.font-bold');
                    lastPlaceScore = scoreElement ? parseInt(scoreElement.textContent) : null;
                }
            }
            
            if (myScoreElement) {
                const scoreText = myScoreElement.textContent.trim();
                myScore = parseInt(scoreText);
            }
            
            return { lastPlaceScore, myScore };
        }, SELECTORS);

        console.log(`📊 Scores - Moi: ${scores.myScore}, Dernier: ${scores.lastPlaceScore}`);

        if (scores.lastPlaceScore === null || scores.myScore === null) {
            console.log("⚠ Scores non disponibles, continuation");
            return true;
        }

        const difference = scores.myScore - scores.lastPlaceScore;
        console.log(`📈 Différence: ${difference} points`);

        if (difference >= 800) {
            console.log(`🛑 Pause de 3h (différence: ${difference})`);
            await sleep(3 * 60 * 60 * 1000);
            return await shouldContinueSolving();
        }

        return true;
    } catch (error) {
        console.error("Erreur vérification scores:", error.message);
        return true;
    }
}

// Fonction principale optimisée
async function solveSudokuProcess() {
    try {
        console.log("=== Démarrage du solveur Sudoku ===");
        
        // Initialisation du navigateur
        currentBrowser = await puppeteer.launch(BROWSER_CONFIG);
        currentPage = await currentBrowser.newPage();
        
        // Configuration optimisée de la page - PERMETTRE CSS ET FONTS
        await currentPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await setupPageInterception(currentPage, true); // allowAll = true pour la page principale

        const cookiesLoaded = await loadCookies(currentPage);
        
        // Gestion de la connexion
        let loginSuccess = false;
        let attempts = 0;
        while (!loginSuccess && attempts < 3) {
            loginSuccess = await handleLogin(cookiesLoaded && attempts === 0);
            if (!loginSuccess) {
                attempts++;
                console.log(`Tentative ${attempts}/3 échouée, retry dans 5s...`);
                await sleep(5000);
            }
        }

        if (!loginSuccess) {
            throw new Error("Échec de connexion après 3 tentatives");
        }

        await saveCookies(currentPage);

        // Initialisation du solveur
        solverPage = await currentBrowser.newPage();
        await setupPageInterception(solverPage, false); // Bloquer les ressources lourdes pour le solveur
        await initializeSolver();

        // Boucle principale
        let roundNumber = 1;
        while (true) {
            // Vérification des scores
            if (solvedCount > 0 && (solvedCount % 100 === 0 || solvedCount >= MAX_SOLVED_PER_SESSION)) {
                await shouldContinueSolving();
                await currentPage.goto("https://sudoku.lumitelburundi.com/game", { waitUntil: "networkidle2", timeout: 20000 });
                await sleep(3000);
                
                if (solvedCount >= MAX_SOLVED_PER_SESSION) {
                    console.log(`🔁 Limite atteinte, réinitialisation`);
                    solvedCount = 0;
                    continue;
                }
            }

            const success = await solveOneSudoku(roundNumber);
            if (success) {
                roundNumber++;
                solvedCount++;
                console.log(`✅ Sudokus résolus: ${solvedCount}/${MAX_SOLVED_PER_SESSION}`);
            } else {
                console.log("🔄 Réinitialisation requise");
                await resetSession();
                roundNumber = 1;
            }
        }
    } catch (error) {
        console.error('❌ Erreur critique:', error.message);
    } finally {
        await closeBrowser();
        cleanup();
    }
}

// Fonction de connexion optimisée
async function handleLogin(useCookies = false) {
    try {
        console.log("🔐 Tentative de connexion...");
        
        await currentPage.goto("https://sudoku.lumitelburundi.com/game", { 
            waitUntil: "networkidle2", 
            timeout: 20000 
        });
        await sleep(3000);
        
        if (currentPage.url().includes("/game")) {
            console.log("✅ Déjà connecté");
            return true;
        }

        console.log("📱 Processus de connexion requis");
        
        // Étape 1: Bouton Kwinjira
        await waitForElement(currentPage, SELECTORS.loginButton, 15000);
        await currentPage.click(SELECTORS.loginButton);
        await currentPage.waitForFunction(() => window.location.href.includes("/login"), { timeout: 15000 });
        
        // Étape 2: Numéro de téléphone
        await waitForElement(currentPage, SELECTORS.phoneInput, 15000);
        
        waitingForPhone = true;
        phoneNumber = '';
        console.log("📱 En attente du numéro...");
        
        while (waitingForPhone || !phoneNumber) {
            await sleep(500);
        }
        
        await currentPage.type(SELECTORS.phoneInput, phoneNumber);
        await currentPage.click(SELECTORS.sendOtpButton);
        await sleep(2000);
        
        // Étape 3: Code OTP
        await waitForElement(currentPage, SELECTORS.otpInput, 15000);
        
        waitingForOTP = true;
        otpCode = '';
        console.log("🔐 En attente de l'OTP...");
        
        while (waitingForOTP || !otpCode) {
            await sleep(500);
        }
        
        await currentPage.type(SELECTORS.otpInput, otpCode);
        await currentPage.click(SELECTORS.confirmButton);
        await sleep(10000);
        
        await currentPage.goto("https://sudoku.lumitelburundi.com/game", { 
            waitUntil: "networkidle2", 
            timeout: 20000 
        });
        await sleep(3000);
        
        return currentPage.url().includes("/game");
    } catch (error) {
        console.error("Erreur connexion:", error.message);
        return false;
    }
}

// Initialisation du solveur optimisée
async function initializeSolver() {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            console.log(`Connexion solveur ${attempt}/3...`);
            await solverPage.goto("https://anysudokusolver.com/", { waitUntil: "networkidle2", timeout: 30000 });
            await sleep(3000);
            
            const hasGrid = await solverPage.$(SELECTORS.solverInputs);
            if (hasGrid) {
                console.log("✅ Solveur initialisé");
                return true;
            }
        } catch (error) {
            console.log(`❌ Tentative ${attempt} échouée: ${error.message}`);
            if (attempt < 3) await sleep(3000);
        }
    }
    throw new Error("Impossible d'initialiser le solveur");
}

// Fonction de résolution optimisée
async function solveOneSudoku(roundNumber) {
    console.log(`\n🎯 ROUND ${roundNumber}`);
    
    try {
        // Récupération de la grille
        await currentPage.bringToFront();
        const gridValues = await getSudokuGrid();
        if (!gridValues) return false;
        
        // Résolution
        await solverPage.bringToFront();
        const solvedValues = await solvePuzzle(gridValues);
        if (!solvedValues) return false;
        
        // Application de la solution
        await currentPage.bringToFront();
        if (!await fillSolution(solvedValues)) return false;
        
        // Nouveau Sudoku
        try {
            await sleep(3000);
            await currentPage.click(SELECTORS.newGameButton);
            await sleep(5000); // Plus de temps pour le chargement
            return true;
        } catch (error) {
            console.log("Échec nouveau Sudoku");
            return false;
        }
        
    } catch (error) {
        console.error(`Erreur round ${roundNumber}:`, error.message);
        return false;
    }
}

// Récupération grille optimisée avec sélecteurs alternatifs
async function getSudokuGrid() {
    try {
        console.log("🔍 Recherche de la grille Sudoku...");
        
        // Attendre que la page soit complètement chargée
        await currentPage.waitForFunction(() => document.readyState === 'complete', { timeout: 10000 });
        await sleep(2000);
        
        // Essayer plusieurs sélecteurs possibles
        const selectors = [
            SELECTORS.sudokuGrid,
            "div.grid.grid-cols-9",
            "[class*='grid'][class*='grid-cols-9']",
            "div[class*='grid-cols-9']"
        ];
        
        let gridValues = null;
        
        for (const selector of selectors) {
            try {
                console.log(`Tentative avec sélecteur: ${selector}`);
                await waitForElement(currentPage, selector, 10000);
                
                gridValues = await currentPage.evaluate((sel) => {
                    const gridContainer = document.querySelector(sel);
                    if (!gridContainer) return null;
                    
                    // Chercher tous les divs enfants qui représentent les cellules
                    const cells = gridContainer.querySelectorAll('div.w-10.h-10');
                    if (cells.length !== 81) {
                        console.log(`Nombre de cellules incorrect: ${cells.length}`);
                        return null;
                    }
                    
                    return Array.from(cells).map(cell => cell.textContent.trim());
                }, selector);
                
                if (gridValues && gridValues.length === 81) {
                    console.log(`✅ Grille trouvée avec ${selector} (${gridValues.filter(v => v).length}/81 cellules remplies)`);
                    break;
                }
            } catch (error) {
                console.log(`❌ Échec avec ${selector}: ${error.message}`);
                continue;
            }
        }
        
        if (!gridValues) {
            // Debug: afficher le HTML de la page
            const pageContent = await currentPage.evaluate(() => {
                const grids = document.querySelectorAll('[class*="grid"]');
                return Array.from(grids).map(grid => ({
                    classes: grid.className,
                    children: grid.children.length,
                    html: grid.outerHTML.substring(0, 200) + '...'
                }));
            });
            console.log("🔍 Grilles trouvées sur la page:", JSON.stringify(pageContent, null, 2));
        }
        
        return gridValues;
    } catch (error) {
        console.error("Erreur récupération grille:", error.message);
        return null;
    }
}

// Résolution puzzle optimisée
async function solvePuzzle(gridValues) {
    try {
        // Vérification URL
        if (!solverPage.url().includes('anysudokusolver.com')) {
            await solverPage.goto("https://anysudokusolver.com/", { waitUntil: "networkidle2", timeout: 30000 });
            await sleep(3000);
        }
        
        // Reset
        await solverPage.click(SELECTORS.solverReset);
        await sleep(1000);
        
        // Saisie
        const inputs = await solverPage.$$(SELECTORS.solverInputs);
        if (inputs.length < 81) {
            throw new Error(`Grille incomplète: ${inputs.length}/81`);
        }
        
        for (let i = 0; i < 81; i++) {
            if (gridValues[i]) {
                await inputs[i].type(gridValues[i]);
                await sleep(30);
            }
        }
        
        // Résolution
        await solverPage.click(SELECTORS.solverSolve);
        await sleep(4000);
        
        // Récupération solution
        const solvedInputs = await solverPage.$$(SELECTORS.solverInputs);
        const solvedValues = [];
        for (let i = 0; i < 81; i++) {
            const value = await solvedInputs[i].evaluate(el => el.value);
            solvedValues.push(value);
        }
        
        return solvedValues.filter(v => v).length > 0 ? solvedValues : null;
    } catch (error) {
        console.error("Erreur résolution:", error.message);
        return null;
    }
}

// Remplissage solution optimisé
async function fillSolution(solvedValues) {
    try {
        const cells = await currentPage.$$(SELECTORS.sudokuCells);
        const numberButtons = await currentPage.$$(SELECTORS.numberButtons);
        
        for (let i = 0; i < 81; i++) {
            const currentValue = await cells[i].evaluate(el => el.textContent.trim());
            const targetValue = solvedValues[i];
            
            if (currentValue === targetValue || !targetValue) continue;
            
            if (!currentValue) {
                await cells[i].click();
                await sleep(200);
                
                const buttonIndex = parseInt(targetValue) - 1;
                if (numberButtons[buttonIndex]) {
                    await numberButtons[buttonIndex].click();
                    await sleep(300);
                }
            }
        }
        return true;
    } catch (error) {
        console.error("Erreur remplissage:", error.message);
        return false;
    }
}

// Réinitialisation session
async function resetSession() {
    try {
        await closeBrowser();
        await sleep(3000);
        
        currentBrowser = await puppeteer.launch(BROWSER_CONFIG);
        currentPage = await currentBrowser.newPage();
        
        await currentPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await setupPageInterception(currentPage, true);
        
        await handleLogin(false);
        await saveCookies(currentPage);
        
        solverPage = await currentBrowser.newPage();
        await setupPageInterception(solverPage, false);
        await initializeSolver();
        
    } catch (error) {
        console.error("Erreur réinitialisation:", error.message);
    }
}

// Fermeture navigateur
async function closeBrowser() {
    try {
        if (currentBrowser) {
            await currentBrowser.close();
            currentBrowser = null;
            currentPage = null;
            solverPage = null;
        }
    } catch (error) {
        console.error("Erreur fermeture:", error.message);
    }
}

// Gestion arrêt propre
process.on('SIGINT', async () => {
    console.log('\n🛑 Arrêt en cours...');
    await closeBrowser();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Arrêt SIGTERM...');
    await closeBrowser();
    process.exit(0);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Sudoku Solver API running on port ${PORT}`);
    console.log(`📱 Endpoints disponibles:`);
    console.log(`   POST /start-sudoku - Démarre le processus`);
    console.log(`   POST /submit-phone - Soumet le numéro`);
    console.log(`   POST /submit-otp - Soumet l'OTP`);
    console.log(`   GET /status - Vérifie le statut`);
});
