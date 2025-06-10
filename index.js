import express from "express";
import puppeteer from "puppeteer";
import * as dotenv from "dotenv";
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
        hasPage: !!currentPage
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

        // Gestion de la connexion avec réessai
        let loginSuccess = false;
        while (!loginSuccess) {
            loginSuccess = await handleLogin();
            if (!loginSuccess) {
                console.log("Nouvelle tentative de connexion dans 10 secondes...");
                await sleep(10000);
                await currentPage.reload();
            }
        }

        // Initialisation de l'onglet de résolution
        console.log("Initialisation de l'onglet de résolution...");
        solverPage = await currentBrowser.newPage();
        await solverPage.goto("https://sudokuspoiler.com/sudoku/sudoku9", { waitUntil: "networkidle2" });
        await sleep(3000);

        let roundNumber = 1;
        const maxRetries = 3;

        while (true) {
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
            } else {
                console.log("🔁 Réinitialisation complète");
                await resetBrowser();
                
                // Reconnexion après réinitialisation
                let reconnectSuccess = false;
                while (!reconnectSuccess) {
                    reconnectSuccess = await handleLogin();
                    if (!reconnectSuccess) {
                        console.log("Nouvelle tentative de connexion dans 10 secondes...");
                        await sleep(10000);
                        await currentPage.reload();
                    }
                }

                // Réinitialisation de l'onglet de résolution
                solverPage = await currentBrowser.newPage();
                await solverPage.goto("https://sudokuspoiler.com/sudoku/sudoku9", { waitUntil: "networkidle2" });
                await sleep(5000);
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

// Fonction de gestion de la connexion
async function handleLogin(maxAttempts = 3) {
    let attempt = 0;
    
    while (attempt < maxAttempts) {
        try {
            console.log(`\nTentative de connexion ${attempt + 1}/${maxAttempts}`);
            
            // Aller directement à la page de jeu
            await currentPage.goto("https://sudoku.lumitelburundi.com/game", { waitUntil: "networkidle2" });
            await sleep(2000);
            
            // Vérifier si on est redirigé vers la page de login
            if (!currentPage.url().includes("https://sudoku.lumitelburundi.com/game")) {
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
        console.log("\nÉtape 2: Résolution sur sudokuspoiler.com");
        await solverPage.bringToFront();
        
        // Fermer les pubs
        await closeAdsOnSpoiler();
        
        // Réinitialisation du solveur
        console.log("Réinitialisation du solveur...");
        await solverPage.click("#resetButton");
        await sleep(1000);
        
        // Saisie de la grille
        console.log("Saisie de la grille...");
        const inputs = await solverPage.$$("#grid input");
        for (let i = 0; i < Math.min(inputs.length, 81); i++) {
            if (gridValues[i]) {
                await inputs[i].type(gridValues[i]);
                await sleep(100);
            }
        }
        
        // Résolution
        console.log("Résolution en cours...");
        await solverPage.click("#solveButton");
        await sleep(3000);
        
        // Récupération de la solution
        const solvedInputs = await solverPage.$$("#grid input");
        const solvedValues = [];
        for (let i = 0; i < Math.min(solvedInputs.length, 81); i++) {
            const value = await solvedInputs[i].evaluate(el => el.value);
            solvedValues.push(value);
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

// Fonction pour fermer les pubs sur SudokuSpoiler
async function closeAdsOnSpoiler() {
    const closeSelectors = [
        'div[id="dismiss-button"]',
        'div.close-button',
        'button[aria-label="Close ad"]',
        'div[aria-label="Close ad"]'
    ];
    
    for (const selector of closeSelectors) {
        try {
            const elements = await solverPage.$$(selector);
            for (const element of elements) {
                const isDisplayed = await element.evaluate(el => {
                    const style = window.getComputedStyle(el);
                    return style.display !== 'none' && style.visibility !== 'hidden';
                });
                if (isDisplayed) {
                    await element.click();
                    await sleep(1000);
                    return true;
                }
            }
        } catch (error) {
            continue;
        }
    }
    return false;
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
