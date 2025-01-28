# 🐳 Puppeteer Deploy on Render.com
#### Demo Scraping Application with Puppeteer on Render Server using Docker.

This is a demo project that demonstrates how to deploy a scraping application using **Puppeteer** on **Render.com** servers. The app uses Docker to containerize the Node.js application, and can be deployed easily with just a few steps.

### Project Overview
This project showcases how to set up a web scraping service using **Puppeteer**, running on **Render.com**. The application scrapes a webpage (e.g., [https://www.arjos.com.br](https://www.arjos.com.br)) and returns its title via an exposed endpoint. 

### How to Deploy the Application

To deploy this demo project on **Render.com**, follow these steps:

1. Log in to your **Render.com** account.
2. Open your **Render Dashboard**.
3. Click on the **"New"** button and select **"Web Service"**.
4. Choose the option to deploy using a **GitHub repository** and select this repository: [arjosweb/puppeteer-render-deploy](https://github.com/arjosweb/puppeteer-render-deploy).
5. Under **"Instance Types"**, choose **"for hobby projects"** (free tier).
6. Click **"Deploy Web Service"**.

In a few minutes, your app will be up and running! 🎉

### Testing the Scraping Endpoint

Once the app is deployed, you can test the scraping endpoint by visiting:
https://puppeteer-render-deploy.onrender.com/scrape


This will trigger the Puppeteer scraping operation and return the title of the page you're scraping.

### Development Commands

#### Build Containers
```bash
docker compose build
```

#### Start all Containers
```bash
docker compose up -d
```

#### Stop all Containers
```bash
docker compose down
```

### License

This project is licensed under the **ISC License**. See the [LICENSE](LICENSE) file for more details.

### Acknowledgments

- [Render.com](https://render.com) for providing an easy-to-use platform for deploying applications.
- [Puppeteer](https://pptr.dev/) for making web scraping straightforward with Node.js.
- [Docker](https://www.docker.com/) for simplifying application containerization.

---

Feel free to open issues or submit pull requests if you have suggestions or improvements! 😊