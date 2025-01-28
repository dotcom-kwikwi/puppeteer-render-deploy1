# Use a imagem base do Ubuntu
FROM ubuntu:22.04

# Define o diretório de trabalho
WORKDIR /app

# Atualiza os pacotes e instala dependências básicas
RUN apt-get update && apt-get upgrade -y && \
    apt-get install -y \
    curl \
    wget \
    gnupg \
    apt-transport-https \
    software-properties-common \
    build-essential \
    git \
    sudo && \
    apt-get clean

# Instala as dependências necessárias para o Puppeteer
RUN apt-get install -y \
    gconf-service \
    libgbm-dev \
    libasound2 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgcc1 \
    libgconf-2-4 \
    libgdk-pixbuf2.0-0 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    ca-certificates \
    fonts-liberation \
    libappindicator1 \
    libnss3 \
    lsb-release \
    xdg-utils && \
    apt-get clean

# Instala o Node.js (versão 18) e o Yarn
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g yarn

# Instala o Google Chrome (para Puppeteer)
RUN wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor > /usr/share/keyrings/google-chrome-keyring.gpg && \
    echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome-keyring.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list && \
    apt-get update && \
    apt-get install -y google-chrome-stable

# Copia os arquivos da aplicação para o container
COPY . .

COPY ./docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Verifica se o arquivo .lock existe; se não, roda yarn install
#RUN if [ -f yarn.lock ]; then yarn install --production; else yarn install; fi
RUN yarn install

# Exponha a porta da aplicação (ajuste se necessário)
EXPOSE 3000

# Define o entrypoint
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

# Comando para iniciar a aplicação
CMD ["yarn", "start"]