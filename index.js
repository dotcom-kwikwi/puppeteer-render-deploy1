import express from "express";
import puppeteer from "puppeteer";
import * as dotenv from "dotenv";
dotenv.config();

const app = express();

app.get("/", async (req, res) => {
    try {
        console.log("Server UP!", {request: req});
        res.send({ msg: "Server is running.", success: true, status_code: 200 });
    } catch (error) {
        console.error("Error running the script:", error);
        res.status(500).send({
            msg: "Error running the script. Check the logs for more details.",
            success: false,
            status_code: 500
        });
    }
});

app.get("/scrape", async (req, res) => {
    let browser;
    try {
        console.log("Starting Puppeteer...");
        browser = await puppeteer.launch({
            args: ["--disable-setuid-sandbox", "--no-sandbox", "--single-process", "--no-zygote"],
            timeout: 60000,
        });

        const page = await browser.newPage();
        const url = "https://www.polovniautomobili.com/motori/pretraga?price_to=700&engine_volume_from=125&sort=1&type%5B0%5D=scooter&without_price=1&showOldNew=both&details=1";
        await page.goto(url, { waitUntil: "domcontentloaded" });

        // Take a screenshot
        await page.screenshot({ path: "screenshot.png", fullPage: true });
        console.log("Screenshot taken: screenshot.png");

        res.send({ screenshot: "screenshot.png", success: true });
    } catch (error) {
        console.error("Error scraping the website:", error);
        res.status(500).send({
            msg: "Error scraping the website. Check the logs for more details.",
            success: false,
            error: error.toString(),
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

