import express from "express";
import puppeteer from "puppeteer";
import * as dotenv from "dotenv";
import { mkdir } from "fs/promises";

dotenv.config();
const app = express();

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

        // Screenshot 1 - posle učitavanja stranice
        await mkdir("/tmp/screenshots", { recursive: true });
        await page.screenshot({ path: "/tmp/screenshots/after-load.png" });
        console.log("Screenshot 1 sačuvan: /tmp/screenshots/after-load.png");

        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const cookieButton = await page.$('#cookieConsentModal button');
        if (cookieButton) {
            await cookieButton.click();
            await new Promise(resolve => setTimeout(resolve, 1000));
            // Screenshot 2 - posle cookie dialoga
            await page.screenshot({ path: "/tmp/screenshots/after-cookies.png" });
            console.log("Screenshot 2 sačuvan: /tmp/screenshots/after-cookies.png");
        }

        try {
            await page.waitForSelector('.AdItem_adOuterHolder__lACeh', { 
                timeout: 30000,
                visible: true
            });
        } catch (error) {
            // Screenshot 3 - kada selektor nije pronađen
            await page.screenshot({ 
                path: "/tmp/screenshots/selector-error.png",
                fullPage: true 
            });
            console.log("Screenshot 3 sačuvan: /tmp/screenshots/selector-error.png");
            throw error;
        }

        const firstAdLink = await page.$eval(
            '.AdItem_adOuterHolder__lACeh a',
            element => element.href
        );

        console.log("Pronađen link prvog oglasa:", firstAdLink);

        res.send({
            success: true,
            link: firstAdLink,
            screenshots: [
                "/tmp/screenshots/after-load.png",
                "/tmp/screenshots/after-cookies.png"
            ],
            status_code: 200
        });

    } catch (error) {
        console.error("Greška pri skrejpanju:", {
            message: error.message,
            stack: error.stack,
            screenshots: [
                "/tmp/screenshots/after-load.png",
                "/tmp/screenshots/after-cookies.png",
                "/tmp/screenshots/selector-error.png"
            ]
        });
        res.status(500).send({
            success: false,
            error: error.message,
            debug: {
                screenshots: "/tmp/screenshots/",
                hint: "Provjerite Render.com logs za putanje screenshotova"
            },
            status_code: 500
        });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});
