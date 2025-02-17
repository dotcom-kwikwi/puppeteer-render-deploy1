import express from "express";
import puppeteer from "puppeteer";
import * as dotenv from "dotenv";

dotenv.config();
const app = express();

app.get("/", async (req, res) => {
    try {
        res.send({ 
            msg: "Server is running. Use /scrape endpoint to get data.",
            success: true,
            status_code: 200 
        });
    } catch (error) {
        console.error("Error:", error);
        res.status(500).send({
            msg: "Server error",
            success: false,
            status_code: 500
        });
    }
});

app.get("/scrape", async (req, res) => {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                "--disable-setuid-sandbox",
                "--no-sandbox",
                "--single-process",
                "--no-zygote",
                "--disable-dev-shm-usage"
            ],
            timeout: 60000
        });

        const page = await browser.newPage();
        
        await page.goto("https://www.kupujemprodajem.com/bela-tehnika-i-kucni-aparati/ves-masine/pretraga?categoryId=15&groupId=188&locationId=1&priceTo=150&currency=eur&order=posted%20desc", {
            waitUntil: "networkidle2",
            timeout: 60000
        });

        // Zamenjeno waitForTimeout sa setTimeout
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const cookieButton = await page.$('#cookieConsentModal button');
        if (cookieButton) {
            await cookieButton.click();
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        await page.waitForSelector('.AdItem_adCard__gqDfK', { timeout: 30000 });

        const firstAdLink = await page.$eval(
            '.AdItem_adCard__gqDfK a',
            element => element.href
        );

        console.log("Pronađen link prvog oglasa:", firstAdLink);

        res.send({
            success: true,
            link: firstAdLink,
            status_code: 200
        });

    } catch (error) {
        console.error("Greška pri skrejpanju:", error);
        res.status(500).send({
            success: false,
            error: error.message,
            status_code: 500
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
