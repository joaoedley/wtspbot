FROM node:18

# Instalar dependências necessárias para o Puppeteer
RUN apt-get update && apt-get install -y \
    libgconf-2-4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgobject-2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar arquivos do projeto
COPY package*.json ./
COPY . .

# Instalar dependências
RUN npm install

# Expor a porta
EXPOSE 3000

# Comando para iniciar a aplicação
CMD ["npm", "start"] 