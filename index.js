import express from "express";
import puppeteer from "puppeteer";
import * as dotenv from "dotenv";
dotenv.config();

const app = express();

app.get("/", (req, res) => {
    console.log("Server UP!", { request: req });
    res.send({ msg: "Server is running.", success: true, status_code: 200 });
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

        // Extracting the first ad's ID
        const adId = await page.evaluate(() => {
            const firstAd = document.querySelector("article.classified");
            return firstAd ? firstAd.dataset.id : null;
        });

        if (!adId) {
            throw new Error("No ad found on the page.");
        }

        const adLink = `https://www.polovniautomobili.com/auto-oglasi/${adId}/auto?attp=p0_pv0_pc0_pl1_plv0&show_date=true`;
        console.log("Ad Link:", adLink);

        res.send({ adId, adLink, success: true });
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
