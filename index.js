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

// Obtenir le chemin du répertoire actuel
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Route principale
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

// Route de statut
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

// Route pour démarrer le processus
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
        
        // Lancement du processus en arrière-plan
        solveSudokuProcess().catch(error => {
            console.error("Erreur dans le processus:", error);
            isProcessing = false;
        });

        res.json({
            success: true,
            message: "Processus de résolution démarré"
        });
    } catch (error) {
        isProcessing = false;
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Route pour soumettre le numéro de téléphone
app.post("/submit-phone", async (req, res) => {
    const { phone } = req.body;
    
    if (!waitingForPhone) {
        return res.status(400).json({
            success: false,
            error: "Aucune demande de numéro en cours"
        });
    }

    if (!phone) {
        return res.status(400).json({
            success: false,
            error: "Numéro de téléphone requis"
        });
    }

    try {
        phoneNumber = phone;
        waitingForPhone = false;
        
        res.json({
            success: true,
            message: "Numéro de téléphone reçu"
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Route pour soumettre l'OTP
app.post("/submit-otp", async (req, res) => {
    const { otp } = req.body;
    
    if (!waitingForOTP) {
        return res.status(400).json({
            success: false,
            error: "Aucune demande d'OTP en cours"
        });
    }

    if (!otp) {
        return res.status(400).json({
            success: false,
            error: "Code OTP requis"
        });
    }

    try {
        otpCode = otp;
        waitingForOTP = false;
        
        res.json({
            success: true,
            message: "Code OTP reçu"
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Fonction pour sauvegarder les cookies
async function saveCookies(page) {
    try {
        const cookies = await page.cookies();
        const cookiePath = path.join(__dirname, COOKIE_FILE);
        fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2));
        console.log('🍪 Cookies sauvegardés avec succès');
    } catch (error) {
        console.error('Erreur lors de la sauvegarde des cookies:', error);
    }
}

// Fonction pour charger les cookies
async function loadCookies(page) {
    try {
        const cookiePath = path.join(__dirname, COOKIE_FILE);
        if (fs.existsSync(cookiePath)) {
            const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
            await page.setCookie(...cookies);
            console.log('🍪 Cookies chargés avec succès');
            return true;
        }
        return false;
    } catch (error) {
        console.error('Erreur lors du chargement des cookies:', error);
        return false;
    }
}

// Fonction pour vérifier le score et déterminer si on doit continuer
async function shouldContinueSolving() {
    try {
        console.log("🔍 Vérification des scores...");
        await currentPage.goto("https://sudoku.lumitelburundi.com", { waitUntil: "networkidle2" });
        await sleep(3000);

        // Récupérer le score du dernier du classement
        const lastPlaceScore = await currentPage.evaluate(() => {
            // Sélecteur simplifié pour le classement
            const leaderboard = document.querySelector('div.mt-6.border.rounded-lg.p-4');
            if (!leaderboard) return null;
            
            const leaderboardItems = leaderboard.querySelectorAll('div.space-y-3 > div');
            if (leaderboardItems.length === 0) return null;
            
            const lastItem = leaderboardItems[leaderboardItems.length - 1];
            const scoreElement = lastItem.querySelector('span.text-lg.font-bold');
            return scoreElement ? parseInt(scoreElement.textContent) : null;
        });

        // Récupérer mon score
const myScore = await currentPage.evaluate(() => {
    // Sélecteur plus précis pour le span contenant le score
    const scoreElement = document.querySelector('div.relative.z-10.bg-teal-800\\/70 span.text-white.ml-4');
    if (!scoreElement) {
        console.log("Élément du score non trouvé");
        return null;
    }
    
    // Extraire uniquement les chiffres du texte
    const scoreText = scoreElement.textContent.trim();
    const scoreNumber = parseInt(scoreText);
    
    if (isNaN(scoreNumber)) {
        console.log("Impossible d'extraire le nombre du texte:", scoreText);
        return null;
    }
    
    return scoreNumber;
});

        console.log(`📊 Scores - Moi: ${myScore}, Dernier: ${lastPlaceScore}`);

        if (lastPlaceScore === null || myScore === null) {
            console.log("⚠ Impossible de récupérer les scores, continuation par défaut");
            return true;
        }

        // Vérifier la différence
        const difference = myScore - lastPlaceScore;
        console.log(`📈 Différence: ${difference} points`);

        if (difference >= 500) {
            console.log(`🛑 Différence de 500+ points atteinte (${difference}), pause de 30 minutes`);
            await sleep(30 * 60 * 1000); // 30 minutes
            return await shouldContinueSolving(); // Vérifier à nouveau après la pause
        }

        return true;
    } catch (error) {
        console.error("Erreur lors de la vérification des scores:", error);
        return true; // Continuer par défaut en cas d'erreur
    }
}

// Fonction principale de résolution
async function solveSudokuProcess() {
    try {
        console.log("=== Démarrage du solveur Sudoku ===");
        
        // Initialisation du navigateur
        currentBrowser = await puppeteer.launch({
            args: [
                "--disable-setuid-sandbox",
                "--no-sandbox",
                "--single-process",
                "--no-zygote",
                "--disable-dev-shm-usage"
            ],
            executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome-stable",
            headless: "new",
            timeout: 60000
        });

        currentPage = await currentBrowser.newPage();
        await currentPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await currentPage.setViewport({ width: 1280, height: 720 });

        // Essayer de charger les cookies
        const cookiesLoaded = await loadCookies(currentPage);
        
        // Gestion de la connexion avec réessai
        let loginSuccess = false;
        while (!loginSuccess) {
            loginSuccess = await handleLogin(cookiesLoaded);
            if (!loginSuccess) {
                console.log("Nouvelle tentative de connexion dans 10 secondes...");
                await sleep(10000);
                await currentPage.reload();
                cookiesLoaded = false; // Après un échec, ne plus supposer que les cookies sont valides
            }
        }

        // Sauvegarder les cookies après connexion réussie
        await saveCookies(currentPage);

        // Initialisation de l'onglet de résolution
        console.log("Initialisation de l'onglet de résolution...");
        solverPage = await currentBrowser.newPage();
        
        // Tentative de connexion au solveur avec plusieurs essais
        let solverConnected = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                console.log(`Tentative ${attempt}/3 de connexion à anysudokusolver.com...`);
                await solverPage.goto("https://anysudokusolver.com/", { 
                    waitUntil: "domcontentloaded", 
                    timeout: 60000 
                });
                await sleep(3000);
                
                // Vérifier que la page s'est bien chargée
                const hasGrid = await solverPage.$('input.c');
                if (hasGrid) {
                    console.log("✅ Solveur connecté avec succès!");
                    solverConnected = true;
                    break;
                } else {
                    console.log(`❌ Tentative ${attempt} échouée - grille non trouvée`);
                }
            } catch (error) {
                console.log(`❌ Tentative ${attempt} échouée: ${error.message}`);
                if (attempt < 3) {
                    await sleep(5000);
                }
            }
        }
        
        if (!solverConnected) {
            throw new Error("Impossible de se connecter au solveur après 3 tentatives");
        }

        let roundNumber = 1;
        const maxRetries = 3;

        while (true) {
            // Vérifier si on doit continuer avant chaque nouveau Sudoku
            if (solvedCount > 0 && (solvedCount % 50 === 0 || solvedCount >= MAX_SOLVED_PER_SESSION)) {
                const shouldContinue = await shouldContinueSolving();

                // vu que l'on a passer a une autre page pour la verification il faut que l'on retourne a la page des jeux
                await currentPage.goto("https://sudoku.lumitelburundi.com/game", { waitUntil: "networkidle2" });
                await sleep(3000); // Attendre que la page soit bien chargée
                
                if (!shouldContinue) {
                    console.log("🛑 Arrêt demandé par la logique de score");
                    continue;
                }

                if (solvedCount >= MAX_SOLVED_PER_SESSION) {
                    console.log(`🔁 Limite de ${MAX_SOLVED_PER_SESSION} Sudokus atteinte, réinitialisation`);
                    //await resetBrowser(); // commenter par ce que on ne veut pas reinitialiser le navigateur
                    solvedCount = 0;
                    continue;
                }
            }

            let retries = 0;
            let success = false;

            while (!success && retries < maxRetries) {
                success = await solveOneSudoku(roundNumber);
                if (!success) {
                    retries++;
                    console.log(`🔄 Tentative ${retries}/${maxRetries}`);
                    await sleep(2000);
                }
            }

            if (success) {
                roundNumber++;
                solvedCount++;
                console.log(`✅ Sudoku résolus ce cycle: ${solvedCount}/${MAX_SOLVED_PER_SESSION}`);
            } else {
                console.log("🔁 Réinitialisation complète");
                await resetBrowser();
                solvedCount = 0;
                
                // Reconnexion après réinitialisation
                let reconnectSuccess = false;
                while (!reconnectSuccess) {
                    reconnectSuccess = await handleLogin(false);
                    if (!reconnectSuccess) {
                        console.log("Nouvelle tentative de connexion dans 10 secondes...");
                        await sleep(10000);
                        await currentPage.reload();
                    }
                }

                // Sauvegarder les cookies après reconnexion
                await saveCookies(currentPage);

                // Réinitialisation de l'onglet de résolution
                solverPage = await currentBrowser.newPage();
                
                // Tentative de reconnexion au solveur
                let reconnected = false;
                for (let attempt = 1; attempt <= 3; attempt++) {
                    try {
                        console.log(`Reconnexion solveur ${attempt}/3...`);
                        await solverPage.goto("https://anysudokusolver.com/", { 
                            waitUntil: "domcontentloaded", 
                            timeout: 60000 
                        });
                        await sleep(3000);
                        
                        const hasGrid = await solverPage.$('input.c');
                        if (hasGrid) {
                            reconnected = true;
                            break;
                        }
                    } catch (error) {
                        console.log(`Erreur reconnexion ${attempt}: ${error.message}`);
                        if (attempt < 3) {
                            await sleep(5000);
                        }
                    }
                }
                
                if (!reconnected) {
                    console.log("❌ Échec reconnexion solveur - nouvelle réinitialisation");
                    continue;
                }
                
                await sleep(2000);
            }
        }
    } catch (error) {
        console.error('❌ Erreur:', error);
    } finally {
        if (currentBrowser) {
            await currentBrowser.close();
        }
        isProcessing = false;
        console.log('👋 Processus terminé');
    }
}

// Fonction de gestion de la connexion (modifiée pour accepter le paramètre cookiesLoaded)
async function handleLogin(cookiesLoaded = false, maxAttempts = 3) {
    let attempt = 0;
    
    while (attempt < maxAttempts) {
        try {
            console.log(`\nTentative de connexion ${attempt + 1}/${maxAttempts}`);
            
            // Aller directement à la page de jeu
            await currentPage.goto("https://sudoku.lumitelburundi.com/game", { waitUntil: "networkidle2" });
            await sleep(2000);
            
            // Vérifier si on est redirigé vers la page de login
            const currentUrl = currentPage.url();
            if (!currentUrl.includes("https://sudoku.lumitelburundi.com/game")) {
                if (cookiesLoaded) {
                    console.log("Redirection malgré les cookies, ils sont peut-être expirés");
                    cookiesLoaded = false;
                }
                
                console.log("Redirection détectée, démarrage du processus de connexion...");
                
                // Étape 1: Cliquer sur le bouton Kwinjira
                console.log("Étape 1: Clique sur le bouton Kwinjira");
                await currentPage.waitForSelector("button.w-53.py-3.px-6.bg-gradient-to-r.from-amber-400.to-amber-500.text-white.text-lg.font-bold.rounded-full.shadow-lg.mt-36", { timeout: 30000 });
                await currentPage.click("button.w-53.py-3.px-6.bg-gradient-to-r.from-amber-400.to-amber-500.text-white.text-lg.font-bold.rounded-full.shadow-lg.mt-36");
                await sleep(2000);
                
                // Attendre la redirection vers la page de login
                await currentPage.waitForFunction(() => window.location.href.includes("/login"));
                
                // Étape 2: Saisie du numéro de téléphone
                console.log("Étape 2: Demande du numéro de téléphone");
                await currentPage.waitForSelector("input[placeholder='Nimushiremwo inomero ya terefone']", { timeout: 30000 });
                
                // Demander le numéro à l'utilisateur via l'API
                waitingForPhone = true;
                phoneNumber = '';
                console.log("📱 En attente du numéro de téléphone via l'API...");
                
                while (waitingForPhone || !phoneNumber) {
                    await sleep(1000);
                }
                
                await currentPage.type("input[placeholder='Nimushiremwo inomero ya terefone']", phoneNumber);
                await sleep(1000);
                
                // Cliquer sur le bouton Rungika OTP
                await currentPage.click("button.w-full.py-2.bg-red-700.text-white.rounded-md.font-semibold.hover\\:bg-red-600.transition.duration-200");
                await sleep(2000);
                
                // Étape 3: Saisie du code OTP
                console.log("Étape 3: Demande du code OTP");
                await currentPage.waitForSelector("input[placeholder='OTP']", { timeout: 30000 });
                
                // Demander le code OTP à l'utilisateur via l'API
                waitingForOTP = true;
                otpCode = '';
                console.log("🔐 En attente du code OTP via l'API...");
                
                while (waitingForOTP || !otpCode) {
                    await sleep(1000);
                }
                
                await currentPage.type("input[placeholder='OTP']", otpCode);
                await sleep(1000);
                
                // Cliquer sur le bouton Emeza
                await currentPage.click("button.w-full.py-2.bg-red-700.text-white.rounded-md.font-semibold.hover\\:bg-red-800.transition.duration-200");
                
                // Attendre 10 secondes comme demandé
                console.log("Attente de 10 secondes...");
                await sleep(10000);
                
                // Maintenant, aller manuellement à la page de jeu
                console.log("Navigation vers la page de jeu...");
                await currentPage.goto("https://sudoku.lumitelburundi.com/game", { waitUntil: "networkidle2" });
                await sleep(3000);
                
                // Vérifier si on est toujours redirigé
                if (!currentPage.url().includes("https://sudoku.lumitelburundi.com/game")) {
                    console.log("La connexion a échoué, nouvelle tentative...");
                    attempt++;
                    continue;
                } else {
                    console.log("Connexion réussie!");
                    return true;
                }
            } else {
                console.log("Déjà connecté, poursuite du script...");
                return true;
            }
            
        } catch (error) {
            console.log(`Erreur lors de la tentative de connexion: ${error.message}`);
            attempt++;
            await sleep(5000);
            continue;
        }
    }
    
    console.log(`Échec après ${maxAttempts} tentatives de connexion`);
    return false;
}

// Fonction pour résoudre un Sudoku
async function solveOneSudoku(roundNumber) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🎯 ROUND ${roundNumber}`);
    console.log(`${'='.repeat(50)}`);
    
    try {
        // Étape 1: Récupération de la grille
        console.log("Étape 1: Chargement de la grille sur sudoku.lumitelburundi.com");
        await currentPage.bringToFront();
        
        console.log("Récupération de la grille...");
        const gridValues = await getSudokuGrid();
        if (!gridValues) {
            return false;
        }
        
        // Étape 2: Résolution sur le deuxième onglet
        console.log("\nÉtape 2: Résolution sur anysudokusolver.com");
        await solverPage.bringToFront();

        let solvedValues = []; // Déclaration au niveau de la fonction

        try {
            // Vérifier que la page du solveur est encore accessible
            const currentUrl = solverPage.url();
            if (!currentUrl.includes('anysudokusolver.com')) {
                console.log("⚠ Page solveur perdue, rechargement...");
                await solverPage.goto("https://anysudokusolver.com/", { 
                    waitUntil: "domcontentloaded", 
                    timeout: 60000 
                });
                await sleep(3000);
            }
            
            // Réinitialisation du solveur
            console.log("Réinitialisation du solveur...");
            await solverPage.waitForSelector("input[type='reset']", { timeout: 30000 });
            await solverPage.click("input[type='reset']");
            await sleep(1000);
            
            // Saisie de la grille
            console.log("Saisie de la grille...");
            const inputs = await solverPage.$$('input.c');
            
            if (inputs.length < 81) {
                throw new Error(`Grille incomplète: ${inputs.length} cases trouvées au lieu de 81`);
            }
            
            for (let i = 0; i < Math.min(inputs.length, 81); i++) {
                if (gridValues[i]) {
                    await inputs[i].type(gridValues[i]);
                    await sleep(50);
                }
            }
            
            // Résolution
            console.log("Résolution en cours...");
            await solverPage.click("input[value='Solve']");
            await sleep(4000);
            
            // Récupération de la solution
            const solvedInputs = await solverPage.$$('input.c');
            solvedValues = []; // Réinitialisation
            for (let i = 0; i < Math.min(solvedInputs.length, 81); i++) {
                const value = await solvedInputs[i].evaluate(el => el.value);
                solvedValues.push(value);
            }
            
            if (solvedValues.filter(v => v).length === 0) {
                throw new Error("Aucune solution trouvée");
            }
            
            console.log(`✅ Solution obtenue: ${solvedValues.filter(v => v).length}/81 cases`);
            
        } catch (error) {
            console.error(`❌ Erreur sur le solveur: ${error.message}`);
            return false;
        }

        // Étape 3: Retour au premier onglet
        console.log("\nÉtape 3: Retour à l'application principale");
        await currentPage.bringToFront();
                
        // Vérifier si la grille est toujours là
        const stillThere = await getSudokuGrid();
        if (!stillThere) {
            console.log("Rechargement de la page...");
            await currentPage.reload({ waitUntil: "networkidle2" });
            await sleep(3000);
            if (!await getSudokuGrid()) {
                return false;
            }
        }
        
        // Remplissage de la solution
        console.log("Remplissage de la solution...");
        const success = await fillSolution(solvedValues);
        if (!success) {
            return false;
        }
        
        // Étape 4: Nouveau Sudoku
        console.log("\nÉtape 4: Chargement d'un nouveau Sudoku");
        try {
            await currentPage.click("button.py-2.px-4.bg-red-800.text-white.rounded-full.ml-5");
            await sleep(4000);
            console.log("Nouvelle grille chargée avec succès!");
            return true;
        } catch (error) {
            console.log("Échec du chargement d'une nouvelle grille");
            return false;
        }
        
    } catch (error) {
        console.error(`Erreur dans la résolution: ${error.message}`);
        return false;
    }
}

// Fonction pour récupérer la grille Sudoku
async function getSudokuGrid() {
    try {
        await currentPage.waitForSelector("div.grid.grid-cols-9.gap-0.border-4.border-black", { timeout: 30000 });
        
        const gridValues = await currentPage.evaluate(() => {
            const cells = document.querySelectorAll("div.grid.grid-cols-9.gap-0.border-4.border-black div.w-10.h-10");
            return Array.from(cells).map(cell => cell.textContent.trim());
        });
        
        if (gridValues.length === 81) {
            return gridValues;
        } else {
            console.log("Grille incomplète trouvée");
            return null;
        }
    } catch (error) {
        console.error(`Erreur récupération grille: ${error.message}`);
        return null;
    }
}

// Fonction pour remplir la solution
async function fillSolution(solvedValues) {
    try {
        const cells = await currentPage.$$("div.grid.grid-cols-9.gap-0.border-4.border-black div.w-10.h-10");
        const numberButtons = await currentPage.$$("div.flex.gap-2.mt-4 button");
        
        for (let i = 0; i < Math.min(cells.length, 81); i++) {
            const currentValue = await cells[i].evaluate(el => el.textContent.trim());
            const targetValue = solvedValues[i];
            
            if (currentValue === targetValue) {
                continue;
            }
            
            if (!currentValue && targetValue) {
                for (let attempt = 0; attempt < 3; attempt++) {
                    try {
                        const currentVal = await cells[i].evaluate(el => el.textContent.trim());
                        if (currentVal === targetValue) {
                            break;
                        }
                        
                        if (!currentVal) {
                            await cells[i].click();
                            await sleep(300);
                            
                            const isSelected = await cells[i].evaluate(el => 
                                el.className.includes("bg-blue-200")
                            );
                            
                            if (isSelected && numberButtons[parseInt(targetValue) - 1]) {
                                await numberButtons[parseInt(targetValue) - 1].click();
                                await sleep(500);
                                
                                const newValue = await cells[i].evaluate(el => el.textContent.trim());
                                if (newValue === targetValue) {
                                    break;
                                } else {
                                    console.log(`⚠ Réessai case ${i} (valeur non prise)`);
                                    await sleep(1000);
                                }
                            }
                        }
                    } catch (error) {
                        console.log(`Erreur case ${i}: ${error.message.substring(0, 50)}`);
                        await sleep(1000);
                        continue;
                    }
                }
            }
        }
        return true;
    } catch (error) {
        console.error(`Erreur remplissage: ${error.message}`);
        return false;
    }
}

// Fonction pour réinitialiser le navigateur
async function resetBrowser() {
    try {
        if (currentBrowser) {
            await currentBrowser.close();
        }
        
        currentBrowser = await puppeteer.launch({
            args: [
                "--disable-setuid-sandbox",
                "--no-sandbox",
                "--single-process",
                "--no-zygote",
                "--disable-dev-shm-usage"
            ],
            executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome-stable",
            headless: "new",
            timeout: 60000
        });

        currentPage = await currentBrowser.newPage();
        await currentPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await currentPage.setViewport({ width: 1280, height: 720 });
    } catch (error) {
        console.error("Erreur lors de la réinitialisation:", error);
    }
}

// Fonction utilitaire pour sleep
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Gestion de l'arrêt propre
process.on('SIGINT', async () => {
    console.log('\n🛑 Arrêt par utilisateur');
    if (currentBrowser) {
        await currentBrowser.close();
    }
    process.exit(0);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Sudoku Solver API running on port ${PORT}`);
    console.log(`📱 Endpoints disponibles:`);
    console.log(`   POST /start-sudoku - Démarre le processus`);
    console.log(`   POST /submit-phone - Soumet le numéro (body: {phone: "123456789"})`);
    console.log(`   POST /submit-otp - Soumet l'OTP (body: {otp: "123456"})`);
    console.log(`   GET /status - Vérifie le statut`);
});
