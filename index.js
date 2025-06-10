import puppeteer from 'puppeteer';
import readline from 'readline';

// Configuration de readline pour l'interaction utilisateur
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Fonction pour poser une question à l'utilisateur
const askQuestion = (question) => new Promise(resolve => rl.question(question, resolve));

// Gestionnaire de signal pour l'arrêt propre
process.on('SIGINT', async () => {
    console.log('\n🛑 Arrêt par utilisateur');
    if (browser) await browser.close();
    rl.close();
    process.exit(0);
});

let browser;

async function waitForPageLoad(page, timeout = 30000) {
    try {
        await page.waitForFunction('document.readyState === "complete"', { timeout });
        await page.waitForTimeout(2000);
        return true;
    } catch (error) {
        console.log("⚠ Le chargement de la page a pris trop de temps");
        return false;
    }
}

async function ensureTabExists(page, tabIndex, url = null) {
    try {
        const pages = await browser.pages();
        if (pages.length <= tabIndex) {
            const newPage = await browser.newPage();
            await newPage.bringToFront();
            await page.waitForTimeout(1000);
        }

        const targetPage = (await browser.pages())[tabIndex];
        await targetPage.bringToFront();

        if (url) {
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                url = 'https://' + url;
            }
            const currentUrl = await targetPage.url();
            if (currentUrl !== url) {
                await targetPage.goto(url, { waitUntil: 'domcontentloaded' });
                if (!(await waitForPageLoad(targetPage))) {
                    return null;
                }
            }
        }
        return targetPage;
    } catch (error) {
        console.log(`Erreur gestion onglet: ${error.message.slice(0, 100)}`);
        return null;
    }
}

async function closeAdsOnSpoiler(page) {
    const closeSelectors = [
        'div[id="dismiss-button"]',
        'div.close-button',
        'button[aria-label="Close ad"]',
        'div[aria-label="Close ad"]'
    ];

    for (const selector of closeSelectors) {
        try {
            const elements = await page.$$(selector);
            for (const el of elements) {
                if (await el.isVisible()) {
                    await el.click();
                    await page.waitForTimeout(1000);
                    return true;
                }
            }
        } catch (error) {
            continue;
        }
    }
    return false;
}

async function persistentClick(page, selector, description, maxAttempts = 3) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            const element = await page.waitForSelector(selector, { visible: true, timeout: 10000 });
            await element.evaluate(el => el.scrollIntoView({ block: 'center' }));
            await element.click();
            await page.waitForTimeout(500);
            return true;
        } catch (error) {
            if (attempt === maxAttempts - 1) {
                console.log(`Échec clic sur ${description}`);
            }
            await page.waitForTimeout(1000);
        }
    }
    return false;
}

async function getSudokuGrid(page) {
    try {
        const gridSelector = 'div.grid.grid-cols-9.gap-0.border-4.border-black';
        await page.waitForSelector(gridSelector, { visible: true, timeout: 10000 });
        
        const cells = await page.$$eval(`${gridSelector} div.w-10.h-10`, divs => 
            divs.map(div => div.textContent.trim())
        );
        
        if (cells.length !== 81) {
            throw new Error('Grille incomplète');
        }

        await page.waitForSelector('div.flex.gap-2.mt-4 button', { visible: true });
        return cells;
    } catch (error) {
        console.log(`Erreur récupération grille: ${error.message.slice(0, 100)}`);
        return null;
    }
}

async function fillSolution(page, solvedValues) {
    try {
        const gridSelector = 'div.grid.grid-cols-9.gap-0.border-4.border-black';
        await page.waitForSelector(gridSelector, { visible: true });

        const cells = await page.$$(`${gridSelector} div.w-10.h-10`);
        const numberButtons = await page.$$('div.flex.gap-2.mt-4 button');

        for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            const targetValue = solvedValues[i];
            
            const currentValue = await cell.evaluate(el => el.textContent.trim());
            
            if (currentValue === targetValue) continue;
            
            if (!currentValue && targetValue) {
                for (let attempt = 0; attempt < 3; attempt++) {
                    try {
                        const currentValue = await cell.evaluate(el => el.textContent.trim());
                        if (currentValue === targetValue) break;
                        
                        if (!currentValue) {
                            await cell.click();
                            await page.waitForTimeout(300);
                            
                            const classList = await cell.evaluate(el => el.className);
                            if (classList.includes('bg-blue-200')) {
                                const btn = numberButtons[parseInt(targetValue) - 1];
                                await btn.click();
                                await page.waitForTimeout(500);
                                
                                const newValue = await cell.evaluate(el => el.textContent.trim());
                                if (newValue === targetValue) break;
                                else {
                                    console.log(`⚠ Réessai case ${i} (valeur non prise)`);
                                    await page.waitForTimeout(1000);
                                }
                            }
                        }
                    } catch (error) {
                        console.log(`Erreur case ${i}: ${error.message.slice(0, 50)}`);
                        await page.waitForTimeout(1000);
                        continue;
                    }
                }
            }
        }
        return true;
    } catch (error) {
        console.log(`Erreur remplissage: ${error.message.slice(0, 100)}`);
        return false;
    }
}

async function handleLogin(page) {
    const maxAttempts = 3;
    let attempt = 0;
    
    while (attempt < maxAttempts) {
        try {
            console.log(`\nTentative de connexion ${attempt + 1}/${maxAttempts}`);
            
            // Aller directement à la page de jeu
            await page.goto('https://sudoku.lumitelburundi.com/game', { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(2000);
            
            // Vérifier si on est redirigé vers la page de login
            if (!page.url().includes('https://sudoku.lumitelburundi.com/game')) {
                console.log('Redirection détectée, démarrage du processus de connexion...');
                
                // Étape 1: Cliquer sur le bouton Kwinjira
                console.log('Étape 1: Clique sur le bouton Kwinjira');
                const kwinjiraBtn = await page.waitForSelector(
                    'button.w-53.py-3.px-6.bg-gradient-to-r.from-amber-400.to-amber-500.text-white.text-lg.font-bold.rounded-full.shadow-lg.mt-36',
                    { visible: true, timeout: 10000 }
                );
                await kwinjiraBtn.click();
                await page.waitForTimeout(2000);
                
                // Attendre la redirection vers la page de login
                await page.waitForFunction(() => window.location.href.includes('/login'));
                
                // Étape 2: Saisie du numéro de téléphone
                console.log('Étape 2: Saisie du numéro de téléphone');
                const phoneInput = await page.waitForSelector(
                    'input[placeholder="Nimushiremwo inomero ya terefone"]',
                    { visible: true, timeout: 10000 }
                );
                
                // Demander le numéro à l'utilisateur
                const phoneNumber = await askQuestion('Entrez votre numéro de téléphone: ');
                await phoneInput.click({ clickCount: 3 });
                await phoneInput.type(phoneNumber);
                await page.waitForTimeout(1000);
                
                // Cliquer sur le bouton Rungika OTP
                const otpBtn = await page.waitForSelector(
                    'button.w-full.py-2.bg-red-700.text-white.rounded-md.font-semibold.hover\\:bg-red-600.transition.duration-200',
                    { visible: true, timeout: 10000 }
                );
                await otpBtn.click();
                await page.waitForTimeout(2000);
                
                // Étape 3: Saisie du code OTP
                console.log('Étape 3: Saisie du code OTP');
                const otpInput = await page.waitForSelector(
                    'input[placeholder="OTP"]',
                    { visible: true, timeout: 10000 }
                );
                
                // Demander le code OTP à l'utilisateur
                const otpCode = await askQuestion('Entrez le code OTP reçu: ');
                await otpInput.click({ clickCount: 3 });
                await otpInput.type(otpCode);
                await page.waitForTimeout(1000);
                
                // Cliquer sur le bouton Emeza
                const emezaBtn = await page.waitForSelector(
                    'button.w-full.py-2.bg-red-700.text-white.rounded-md.font-semibold.hover\\:bg-red-800.transition.duration-200',
                    { visible: true, timeout: 10000 }
                );
                await emezaBtn.click();
                
                // Attendre 10 secondes comme demandé
                console.log('Attente de 10 secondes...');
                await page.waitForTimeout(10000);
                
                // Maintenant, aller manuellement à la page de jeu
                console.log('Navigation vers la page de jeu...');
                await page.goto('https://sudoku.lumitelburundi.com/game', { waitUntil: 'domcontentloaded' });
                await page.waitForTimeout(3000);
                
                // Vérifier si on est toujours redirigé
                if (!page.url().includes('https://sudoku.lumitelburundi.com/game')) {
                    console.log('La connexion a échoué, nouvelle tentative...');
                    attempt++;
                    continue;
                } else {
                    console.log('Connexion réussie!');
                    return true;
                }
            } else {
                console.log('Déjà connecté, poursuite du script...');
                return true;
            }
        } catch (error) {
            console.log(`Erreur lors de la tentative de connexion: ${error.message}`);
            attempt++;
            await page.waitForTimeout(5000);
            continue;
        }
    }
    
    console.log(`Échec après ${maxAttempts} tentatives de connexion`);
    return false;
}

async function solveOneSudoku(mainPage, spoilerPage, roundNumber) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🎯 ROUND ${roundNumber}`);
    console.log(`${'='.repeat(50)}`);
    
    // Étape 1: Récupération sur le premier onglet
    console.log('Étape 1: Chargement de la grille sur sudoku.lumitelburundi.com');
    await mainPage.bringToFront();
    await mainPage.goto('https://sudoku.lumitelburundi.com/game', { waitUntil: 'domcontentloaded' });
    
    console.log('Récupération de la grille...');
    const gridValues = await getSudokuGrid(mainPage);
    if (!gridValues) return false;
    
    // Étape 2: Résolution sur le deuxième onglet
    console.log('\nÉtape 2: Résolution sur sudokuspoiler.com');
    await spoilerPage.bringToFront();
    await spoilerPage.goto('https://sudokuspoiler.com/sudoku/sudoku9', { waitUntil: 'domcontentloaded' });
    
    try {
        console.log('Fermeture des pubs...');
        await closeAdsOnSpoiler(spoilerPage);
        
        console.log('Réinitialisation du solveur...');
        if (!(await persistentClick(spoilerPage, '#resetButton', 'Reset'))) {
            return false;
        }
            
        console.log('Saisie de la grille...');
        const inputs = await spoilerPage.$$('#grid input');
        for (let i = 0; i < inputs.length && i < 81; i++) {
            if (gridValues[i]) {
                await inputs[i].type(gridValues[i]);
                await spoilerPage.waitForTimeout(100);
            }
        }
        
        console.log('Résolution en cours...');
        if (!(await persistentClick(spoilerPage, '#solveButton', 'Solve'))) {
            return false;
        }
            
        await spoilerPage.waitForTimeout(3000);
        const solvedValues = await spoilerPage.$$eval('#grid input', inputs => 
            inputs.slice(0, 81).map(input => input.value)
        );
        
        // Étape 3: Retour au premier onglet
        console.log('\nÉtape 3: Retour à l\'application principale');
        await mainPage.bringToFront();
        
        if (!(await getSudokuGrid(mainPage))) {
            console.log('Rechargement de la page...');
            await mainPage.reload();
            await mainPage.waitForTimeout(3000);
            if (!(await getSudokuGrid(mainPage))) {
                return false;
            }
        }
        
        console.log('Remplissage de la solution...');
        if (!(await fillSolution(mainPage, solvedValues))) {
            return false;
        }
        
        // Étape 4: Nouveau Sudoku
        try {
            console.log('\nÉtape 4: Chargement d\'un nouveau Sudoku');
            const newGameBtn = 'button.py-2.px-4.bg-red-800.text-white.rounded-full.ml-5';
            if (await persistentClick(mainPage, newGameBtn, 'Nouveau Sudoku')) {
                await mainPage.waitForTimeout(4000);
                console.log('Nouvelle grille chargée avec succès!');
                return true;
            }
        } catch (error) {
            console.log('Échec du chargement d\'une nouvelle grille');
            return false;
        }
    } catch (error) {
        console.log(`Échec lors de la résolution: ${error.message}`);
        return false;
    }
    
    return false;
}

async function main() {
    try {
        console.log('=== Démarrage du solveur Sudoku ===');
        browser = await puppeteer.launch({
            headless: false, // Mettre à true pour la production
            args: [
                '--disable-setuid-sandbox',
                '--no-sandbox',
                '--single-process',
                '--no-zygote',
                '--disable-dev-shm-usage'
            ],
            executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome-stable',
            timeout: 60000
        });
        
        // Création des pages
        const mainPage = await browser.newPage();
        await mainPage.setViewport({ width: 1280, height: 720 });
        await mainPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        const spoilerPage = await browser.newPage();
        await spoilerPage.setViewport({ width: 1280, height: 720 });
        
        // Gestion de la connexion avec réessai
        while (true) {
            if (await handleLogin(mainPage)) {
                break;
            } else {
                console.log('Nouvelle tentative de connexion dans 10 secondes...');
                await mainPage.waitForTimeout(10000);
                await mainPage.reload();
            }
        }
        
        // Initialisation de l'onglet de résolution
        console.log('Initialisation de l\'onglet de résolution...');
        await spoilerPage.goto('https://sudokuspoiler.com/sudoku/sudoku9', { waitUntil: 'domcontentloaded' });
        await spoilerPage.waitForTimeout(3000);
        
        let roundNumber = 1;
        const maxRetries = 3;
        
        while (true) {
            let retries = 0;
            let success = false;
            
            while (!success && retries < maxRetries) {
                success = await solveOneSudoku(mainPage, spoilerPage, roundNumber);
                if (!success) {
                    retries++;
                    console.log(`🔄 Tentative ${retries}/${maxRetries}`);
                    await mainPage.waitForTimeout(2000);
                }
            }
            
            if (success) {
                roundNumber++;
            } else {
                console.log('🔁 Réinitialisation complète');
                await browser.close();
                await mainPage.waitForTimeout(2000);
                
                browser = await puppeteer.launch({
                    headless: false,
                    args: [
                        '--disable-setuid-sandbox',
                        '--no-sandbox',
                        '--single-process',
                        '--no-zygote',
                        '--disable-dev-shm-usage'
                    ],
                    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome-stable',
                    timeout: 60000
                });
                
                const newMainPage = await browser.newPage();
                await newMainPage.setViewport({ width: 1280, height: 720 });
                
                // Reconnexion après réinitialisation
                while (true) {
                    if (await handleLogin(newMainPage)) {
                        mainPage = newMainPage;
                        break;
                    } else {
                        console.log('Nouvelle tentative de connexion dans 10 secondes...');
                        await newMainPage.waitForTimeout(10000);
                        await newMainPage.reload();
                    }
                }
                
                // Réinitialisation de l'onglet de résolution
                spoilerPage = await browser.newPage();
                await spoilerPage.goto('https://sudokuspoiler.com/sudoku/sudoku9', { waitUntil: 'domcontentloaded' });
                await spoilerPage.waitForTimeout(5000);
            }
        }
    } catch (error) {
        console.log(`❌ Erreur: ${error.message}`);
    } finally {
        if (browser) await browser.close();
        rl.close();
        console.log('👋 Programme terminé');
    }
}

main().catch(console.error);
