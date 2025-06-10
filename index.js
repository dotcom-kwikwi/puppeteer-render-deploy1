import express from "express";
import puppeteer from "puppeteer";
import * as dotenv from "dotenv";
dotenv.config();

const app = express();

// Middleware pour parser le JSON
app.use(express.json());

// Route de test
app.get("/", (req, res) => {
    res.json({
        message: "Puppeteer API is running",
        endpoints: {
            google: "/google-title - GET - Récupère le titre de Google",
            scrape: "/scrape - GET - Exemple de scraping existant"
        }
    });
});

// Nouvelle route pour récupérer le titre de Google
app.get("/google-title", async (req, res) => {
    let browser;
    try {
        console.log("Launching Puppeteer to fetch Google title...");
        
        // Configuration de Puppeteer pour Render.com
        browser = await puppeteer.launch({
            args: [
                "--disable-setuid-sandbox",
                "--no-sandbox",
                "--single-process",
                "--no-zygote",
                "--disable-dev-shm-usage" // Important pour éviter les problèmes de mémoire
            ],
            executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome-stable",
            headless: "new", // Mode headless plus récent
            timeout: 30000
        });

        const page = await browser.newPage();
        
        // Configuration de la page pour améliorer les performances
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await page.setViewport({ width: 1280, height: 720 });
        
        console.log("Navigating to Google...");
        await page.goto("https://www.google.com", {
            waitUntil: "networkidle2",
            timeout: 30000
        });

        // Récupération du titre
        const title = await page.title();
        console.log("Google title:", title);

        res.json({
            success: true,
            title: title,
            url: "https://www.google.com"
        });

    } catch (error) {
        console.error("Error fetching Google title:", error);
        res.status(500).json({
            success: false,
            error: error.message,
            stack: process.env.NODE_ENV === "development" ? error.stack : undefined
        });
    } finally {
        if (browser) {
            await browser.close();
            console.log("Browser closed");
        }
    }
});

// Route existante pour le scraping (conservée)
app.get("/scrape", async (req, res) => {
    let browser;
    try {
        console.log("Starting Puppeteer...");
        browser = await puppeteer.launch({
            args: ["--disable-setuid-sandbox", "--no-sandbox", "--single-process", "--no-zygote", "--disable-dev-shm-usage"],
            executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome-stable",
            headless: "new",
            timeout: 60000,
        });

        const page = await browser.newPage();
        const url = "https://www.polovniautomobili.com/motori/pretraga?price_to=700&engine_volume_from=125&sort=1&type%5B0%5D=scooter&without_price=1&showOldNew=both&details=1";
        await page.goto(url, { waitUntil: "domcontentloaded" });

        res.json({ 
            success: true,
            message: "Scraping completed successfully"
        });
    } catch (error) {
        console.error("Error scraping the website:", error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
