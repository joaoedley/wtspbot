const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);

// Configurações
const config = {
    sessionPath: './wwebjs_auth',  // Pasta para armazenar a sessão
    adminPhone: '5587996368157',   // Seu número para notificações
    menuImage: './assets/cardapio.png', // Imagem do cardápio
    storeInfo: {
        name: 'Ratão Lanches',
        phone: '5587996368157',
        address: 'Em frente a praça de eventos, ao lado da Quadra'
    },
    deliveryFee: 2.00 // Taxa de entrega
};

// Verifica e cria diretórios necessários
if (!fs.existsSync(config.sessionPath)) {
    fs.mkdirSync(config.sessionPath, { recursive: true });
}
if (!fs.existsSync(path.dirname(config.menuImage))) {
    fs.mkdirSync(path.dirname(config.menuImage), { recursive: true });
}

// Cardápio da lanchonete
const menu = {
    lanches: {
        'Misto': 7.00,
        'X-Salada': 12.00,
        'X-Milho': 15.00,
        'X-Bacon': 15.00,
        'X-Egg': 15.00,
        'X-Calabresa': 15.00,
        'Americano': 10.00,
        'Hambúrguer': 10.00,
        'X-Tudo': 22.00
    },
    adicionais: {
        'Bacon': 3.00,
        'Calabresa': 3.00,
        'Hambúrguer': 3.00,
        'Ovo': 2.00,
        'Salsicha': 2.00
    },
    refrigerantes: {
        // Lata
        'Coca Cola Lata': 6.00,
        'Guarana Lata': 6.00,
        'Soda Lata': 6.00,
        'Sukita Lata': 6.00,
        'Skinka': 6.00,
        'Skol Lata': 5.00,
        // Juninho
        'Coca Juninho': 3.00,
        'Pepsi Juninho': 3.00,
        'Soda Juninho': 3.00,
        'Guarana Juninho': 3.00,
        'Sukita Juninho': 3.00,
        // 1L
        'Coca Cola 1L': 9.00,
        'Guarana 1L': 9.00,
        'Soda 1L': 9.00,
        'Sukita 1L': 9.00
    },
    removiveis: ['Creme de milho', 'Verdura']
};

// Estados do pedido
const ORDER_STATES = {
    IDLE: 0,
    VIEWING_MENU: 1,
    COLLECTING_NAME: 2,
    COLLECTING_ITEMS: 3,
    CUSTOMIZING_ITEM: 4,
    REMOVING_ITEM: 5,
    ADDING_ITEM: 6,
    CHOOSING_DELIVERY: 7,
    COLLECTING_ADDRESS: 8,
    COLLECTING_PAYMENT: 9,
    COLLECTING_CHANGE: 10,
    CONFIRMING: 11
};

// Dados temporários dos pedidos
const tempOrders = {};

// Configuração corrigida do cliente WhatsApp
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: config.sessionPath,
        clientId: "ratao-lanches-bot",
        backupSyncIntervalMs: 300000
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu',
            '--disable-extensions'
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        ignoreHTTPSErrors: true
    },
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    },
    takeoverOnConflict: true,
    takeoverTimeoutMs: 30000,
    restartOnAuthFail: true
});

// Eventos do cliente
client.on('qr', async qr => {
    console.log('QR code gerado no cliente WhatsApp');
    qrcode.generate(qr, { small: true });
    // Gera imagem do QR code e envia para o front-end
    try {
        const qrImage = await QRCode.toDataURL(qr);
        io.emit('qr', qrImage);
    } catch (err) {
        console.error('Erro ao gerar imagem do QR code:', err);
    }
});

client.on('authenticated', () => {
    console.log('Autenticado com sucesso!');
    io.emit('authenticated');
});

client.on('auth_failure', msg => {
    console.error('Falha na autenticação:', msg);
    fs.rmSync(config.sessionPath, { recursive: true, force: true });
});

client.on('ready', () => {
    console.log('Ratão Lanches está pronto para receber pedidos!');
});

client.on('disconnected', (reason) => {
    console.log('Cliente desconectado:', reason);
    fs.rmSync(config.sessionPath, { recursive: true, force: true });
});

// Configuração do servidor web
app.use(express.static('public'));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Socket.io para QR Code
io.on('connection', (socket) => {
    console.log('Cliente conectado ao servidor web');
    socket.on('generateQR', () => {
        // Não faz nada, pois o evento 'qr' já é emitido automaticamente
    });
});

// Fluxo principal de mensagens (apenas para chats privados)
client.on('message', async message => {
    try {
        // Ignora mensagens de grupos
        if (message.from.includes('@g.us')) {
            return;
        }

        const phone = message.from.replace('@c.us', '');
        const userMessage = message.body.trim();
        const userMessageLower = userMessage.toLowerCase();

        // Palavras-chave para ativar o bot (todas variações)
        const ativadores = [
            'oi', 'Oi', 'OI',
            'boa noite', 'Boa noite', 'BOA NOITE',
            'ei', 'Ei', 'EI',
            'ola', 'Ola', 'OLA',
            'olá', 'Olá', 'OLÁ'
        ];

        // Só ativa o bot se for uma saudação
        if (!tempOrders[phone] && !ativadores.some(palavra => userMessage === palavra)) {
            return;
        }

        // Inicializa pedido se não existir
        if (!tempOrders[phone]) {
            tempOrders[phone] = {
                state: ORDER_STATES.IDLE,
                items: [],
                currentItem: null,
                customerName: '',
                customerPhone: phone,
                deliveryType: '',
                deliveryAddress: '',
                paymentMethod: '',
                total: 0
            };
        }
        
        const order = tempOrders[phone];
        
        // Fluxo de conversação
        switch (order.state) {
            case ORDER_STATES.IDLE:
                if (userMessage === 'fazer pedido' || userMessage === 'pedido') {
                    order.state = ORDER_STATES.COLLECTING_NAME;
                    await message.reply('Por favor, digite seu *nome* para começarmos:');
                } else if (userMessage === 'ver cardapio' || userMessage === 'cardapio') {
                    order.state = ORDER_STATES.VIEWING_MENU;
                    await sendMenuImage(message);
                    await sendTextMenu(message);
                    await message.reply('Para fazer um pedido, envie *fazer pedido*.');
                } else {
                    await sendWelcomeMessage(message);
                }
                break;
                
            case ORDER_STATES.VIEWING_MENU:
                if (userMessage === 'fazer pedido' || userMessage === 'pedido') {
                    order.state = ORDER_STATES.COLLECTING_NAME;
                    await message.reply('Por favor, digite seu *nome* para começarmos:');
                } else {
                    order.state = ORDER_STATES.IDLE;
                }
                break;
                
            case ORDER_STATES.COLLECTING_NAME:
                order.customerName = message.body;
                order.state = ORDER_STATES.COLLECTING_ITEMS;
                await message.reply(`Obrigado, ${order.customerName}! Vamos começar seu pedido.`);
                await sendMenuOptions(message);
                break;
                
            case ORDER_STATES.COLLECTING_ITEMS:
                if (userMessageLower === 'finalizar') {
                    if (order.items.length === 0) {
                        await message.reply('Você ainda não adicionou nenhum item. Por favor, escolha um lanche do cardápio.');
                        return;
                    }
                    order.state = ORDER_STATES.CHOOSING_DELIVERY;
                    await message.reply('Como deseja receber seu pedido?\n\n1️⃣ Entrega (Taxa de R$ 2,00)\n2️⃣ Retirada no local\n\nResponda com o número ou nome da opção.');
                } else {
                    // Permitir múltiplos lanches separados por vírgula
                    const itensEscolhidos = userMessage.split(',').map(i => i.trim()).filter(Boolean);
                    let algumValido = false;
                    for (const itemEscolhido of itensEscolhidos) {
                        const selectedItem = findMenuItem(itemEscolhido.toLowerCase());
                        if (selectedItem) {
                            order.currentItem = {
                                name: selectedItem.name,
                                basePrice: selectedItem.price,
                                price: selectedItem.price,
                                quantity: 1,
                                removals: [],
                                additions: []
                            };
                            // Adiciona direto ao pedido sem personalização para múltiplos
                            order.items.push({...order.currentItem});
                            order.total += order.currentItem.price * order.currentItem.quantity;
                            algumValido = true;
                        }
                    }
                    if (algumValido) {
                        await message.reply('Itens adicionados ao pedido!\n\nContinue escolhendo mais itens ou digite *finalizar* para prosseguir.');
                        await sendMenuOptions(message);
                    } else {
                        await sendMenuOptions(message, 'Item não encontrado no cardápio. Por favor, escolha um lanche da lista:');
                    }
                }
                break;
                
            case ORDER_STATES.CUSTOMIZING_ITEM:
                if (userMessage === '4' || userMessage === 'pular' || userMessage === 'pular personalização') {
                    await finalizeItemCustomization(message, order, phone);
                } 
                else if (userMessage === '3' || userMessage === 'confirmar' || userMessage === 'sem personalização') {
                    await finalizeItemCustomization(message, order, phone);
                }
                else if (userMessage === '1' || userMessage === 'remover') {
                    order.state = ORDER_STATES.REMOVING_ITEM;
                    await message.reply(`O que deseja remover do ${order.currentItem.name}?\n\nOpções:\n${menu.removiveis.map((item, i) => `${i+1} - Sem ${item}`).join('\n')}\n\n*Exemplo:* "1" ou "sem creme de milho"`);
                } 
                else if (userMessage === '2' || userMessage === 'adicionar') {
                    order.state = ORDER_STATES.ADDING_ITEM;
                    await message.reply(`O que deseja adicionar ao ${order.currentItem.name}?\n\nOpções:\n${Object.entries(menu.adicionais).map(([name, price], i) => `${i+1} - ${name} (+R$ ${price.toFixed(2)})`).join('\n')}\n\n*Exemplo:* "1" ou "bacon"`);
                }
                else {
                    await sendCustomizationOptions(message, order.currentItem.name, 'Opção inválida. Por favor, escolha uma das opções:');
                }
                break;
                
            case ORDER_STATES.REMOVING_ITEM:
                if (userMessage.includes('sem ')) {
                    const itemToRemove = userMessage.replace('sem ', '');
                    if (menu.removiveis.includes(capitalizeFirstLetter(itemToRemove))) {
                        order.currentItem.removals.push(itemToRemove);
                        await message.reply(`✅ Removido: ${itemToRemove}\n\nDeseja remover mais algo? (responda "sim" ou "não")`);
                    } else {
                        await message.reply('Opção inválida. Por favor, escolha uma das opções de remoção.');
                    }
                } else if (userMessage === 'sim' || userMessage === 's') {
                    await message.reply(`O que mais deseja remover do ${order.currentItem.name}?\n\nOpções:\n${menu.removiveis.map((item, i) => `${i+1} - Sem ${item}`).join('\n')}`);
                } else if (userMessage === 'não' || userMessage === 'nao' || userMessage === 'n') {
                    order.state = ORDER_STATES.CUSTOMIZING_ITEM;
                    await sendCustomizationOptions(message, order.currentItem.name, 'O que mais deseja fazer?');
                } else {
                    const index = parseInt(userMessage) - 1;
                    if (!isNaN(index) && index >= 0 && index < menu.removiveis.length) {
                        const itemToRemove = menu.removiveis[index].toLowerCase();
                        order.currentItem.removals.push(itemToRemove);
                        await message.reply(`✅ Removido: ${itemToRemove}\n\nDeseja remover mais algo? (responda "sim" ou "não")`);
                    } else {
                        await message.reply('Opção inválida. Por favor, escolha uma das opções de remoção.');
                    }
                }
                break;
                
            case ORDER_STATES.ADDING_ITEM:
                if (findAdditional(userMessage)) {
                    const additional = findAdditional(userMessage);
                    order.currentItem.additions.push(additional.name);
                    order.currentItem.price += additional.price;
                    await message.reply(`✅ Adicionado: ${additional.name} (+R$ ${additional.price.toFixed(2)})\n\nDeseja adicionar mais algo? (responda "sim" ou "não")`);
                } else if (userMessage === 'sim' || userMessage === 's') {
                    await message.reply(`O que mais deseja adicionar ao ${order.currentItem.name}?\n\nOpções:\n${Object.entries(menu.adicionais).map(([name, price], i) => `${i+1} - ${name} (+R$ ${price.toFixed(2)})`).join('\n')}`);
                } else if (userMessage === 'não' || userMessage === 'nao' || userMessage === 'n') {
                    order.state = ORDER_STATES.CUSTOMIZING_ITEM;
                    await sendCustomizationOptions(message, order.currentItem.name, 'O que mais deseja fazer?');
                } else {
                    await message.reply('Opção inválida. Por favor, escolha uma das opções de adição.');
                }
                break;
                
            case ORDER_STATES.CHOOSING_DELIVERY:
                if (userMessage === '1' || userMessage === 'entrega') {
                    order.deliveryType = 'Entrega';
                    order.total += config.deliveryFee;
                    order.state = ORDER_STATES.COLLECTING_ADDRESS;
                    await message.reply('Por favor, envie seu *endereço completo* para entrega incluindo complemento e ponto de referência.');
                } else if (userMessage === '2' || userMessage === 'retirada' || userMessage === 'retirada no local') {
                    order.deliveryType = 'Retirada no local';
                    order.deliveryAddress = config.storeInfo.address;
                    order.state = ORDER_STATES.COLLECTING_PAYMENT;
                    await message.reply('Agora escolha a *forma de pagamento*:\n\n1️⃣ Dinheiro\n2️⃣ Cartão de Crédito\n3️⃣ Cartão de Débito\n4️⃣ PIX\n\nResponda com o número ou nome da opção.');
                } else {
                    await message.reply('Opção inválida. Por favor, escolha:\n\n1️⃣ Entrega (Taxa de R$ 2,00)\n2️⃣ Retirada no local');
                }
                break;
                
            case ORDER_STATES.COLLECTING_ADDRESS:
                order.deliveryAddress = message.body;
                order.state = ORDER_STATES.COLLECTING_PAYMENT;
                await message.reply('Agora escolha a *forma de pagamento*:\n\n1️⃣ Dinheiro\n2️⃣ Cartão de Crédito\n3️⃣ Cartão de Débito\n4️⃣ PIX\n\nResponda com o número ou nome da opção.');
                break;
                
            case ORDER_STATES.COLLECTING_PAYMENT:
                const paymentOptions = {
                    '1': 'Dinheiro',
                    'dinheiro': 'Dinheiro',
                    '2': 'Cartão de Crédito',
                    'cartão de crédito': 'Cartão de Crédito',
                    'credito': 'Cartão de Crédito',
                    '3': 'Cartão de Débito',
                    'cartão de débito': 'Cartão de Débito',
                    'debito': 'Cartão de Débito',
                    '4': 'PIX',
                    'pix': 'PIX'
                };
                
                if (paymentOptions[userMessage]) {
                    order.paymentMethod = paymentOptions[userMessage];
                    if (order.paymentMethod === 'Dinheiro') {
                        order.state = ORDER_STATES.COLLECTING_CHANGE;
                        await message.reply(`Por favor, informe o valor que você vai pagar para calcularmos o troco.\n\nExemplo: "troco para 50" ou "troco para 100"`);
                    } else {
                        order.state = ORDER_STATES.CONFIRMING;
                        await sendOrderSummary(message, order);
                    }
                } else {
                    await message.reply('Opção de pagamento inválida. Por favor, escolha uma das opções:\n\n1️⃣ Dinheiro\n2️⃣ Cartão de Crédito\n3️⃣ Cartão de Débito\n4️⃣ PIX');
                }
                break;
                
            case ORDER_STATES.COLLECTING_CHANGE:
                // Aceita "troco para", "troco pra" e também só o número
                let paymentAmount = null;
                let matchTroco = userMessage.match(/troco (para|pra)\s*(\d+[\.,]?\d{0,2})/i);
                let matchNumero = userMessage.match(/^(\d+[\.,]?\d{0,2})$/);
                if (matchTroco) {
                    paymentAmount = parseFloat(matchTroco[2].replace(',', '.'));
                } else if (matchNumero) {
                    paymentAmount = parseFloat(matchNumero[1].replace(',', '.'));
                }
                if (paymentAmount !== null && !isNaN(paymentAmount)) {
                    if (paymentAmount >= order.total) {
                        order.change = paymentAmount - order.total;
                        order.state = ORDER_STATES.CONFIRMING;
                        await sendOrderSummary(message, order);
                    } else {
                        await message.reply(`O valor informado (R$ ${paymentAmount.toFixed(2)}) é menor que o total do pedido (R$ ${order.total.toFixed(2)}). Por favor, informe um valor maior.`);
                    }
                } else {
                    await message.reply('Por favor, informe o valor corretamente. Exemplo: "troco para 50" ou apenas "50"');
                }
                break;
                
            case ORDER_STATES.CONFIRMING:
                if (userMessage === 'sim' || userMessage === 's') {
                    await confirmOrder(message, order, phone);
                } else if (userMessage === 'não' || userMessage === 'nao' || userMessage === 'n') {
                    tempOrders[phone] = {
                        state: ORDER_STATES.IDLE,
                        items: [],
                        currentItem: null,
                        customerName: '',
                        customerPhone: phone,
                        deliveryType: '',
                        deliveryAddress: '',
                        paymentMethod: '',
                        total: 0
                    };
                    await message.reply('Pedido cancelado. Se quiser começar novamente, envie *"fazer pedido"*.');
                } else {
                    await message.reply('Por favor, responda *sim* para confirmar ou *não* para cancelar o pedido.');
                }
                break;
        }
    } catch (error) {
        console.error('Erro ao processar mensagem:', error);
        await message.reply('❌ Ocorreu um erro ao processar sua mensagem. Por favor, tente novamente.');
    }
});

// Funções auxiliares
async function finalizeItemCustomization(message, order, phone) {
    order.items.push({...order.currentItem});
    order.total += order.currentItem.price * order.currentItem.quantity;
    const itemName = order.currentItem.name;
    order.currentItem = null;
    order.state = ORDER_STATES.COLLECTING_ITEMS;
    await message.reply(`✅ ${itemName} adicionado ao pedido!\n\nContinue escolhendo mais itens ou digite *finalizar* para prosseguir.`);
    await sendMenuOptions(message);
}

async function confirmOrder(message, order, phone) {
    const orderId = Date.now();
    const orderData = {
        ...order,
        timestamp: new Date().toISOString(),
        status: 'confirmed'
    };
    
    // Garante que o diretório de pedidos existe
    if (!fs.existsSync('./pedidos')) {
        fs.mkdirSync('./pedidos');
    }
    
    fs.writeFileSync(`./pedidos/pedido_${orderId}.json`, JSON.stringify(orderData, null, 2));
    
    await message.reply('✅ *Pedido confirmado com sucesso!*\n\nSeu pedido foi enviado para nossa cozinha e logo estaremos entregando. 🚀\n\nAgradecemos pela preferência! ❤️');
    
    // Notifica administrador
    if (config.adminPhone) {
        try {
            let adminMsg = '📋 *RESUMO DO PEDIDO* 📋\n\n';
            adminMsg += `👤 *Cliente:* ${order.customerName} (${order.customerPhone})\n`;
            adminMsg += '🍽️ *Itens:*\n';
            order.items.forEach(item => {
                adminMsg += `- ${item.quantity}x ${item.name} - R$ ${item.price.toFixed(2)}\n`;
                if (item.removals.length > 0) {
                    adminMsg += `  🚫 Sem: ${item.removals.join(', ')}\n`;
                }
                if (item.additions.length > 0) {
                    adminMsg += `  ➕ Adicionais: ${item.additions.join(', ')}\n`;
                }
            });
            adminMsg += `\n🚚 *Tipo de Entrega:* ${order.deliveryType}`;
            if (order.deliveryType === 'Entrega') {
                adminMsg += ` (Taxa: R$ ${config.deliveryFee.toFixed(2)})`;
            }
            adminMsg += `\n🏠 *Endereço:* ${order.deliveryAddress}\n`;
            adminMsg += `💳 *Pagamento:* ${order.paymentMethod}\n`;
            if (order.paymentMethod === 'Dinheiro' && order.change !== undefined) {
                adminMsg += `💰 *Valor pago:* R$ ${(order.total + order.change).toFixed(2)}\n`;
                adminMsg += `💰 *Troco:* R$ ${order.change.toFixed(2)}\n`;
            }
            adminMsg += `💰 *Total: R$ ${order.total.toFixed(2)}*\n`;
            adminMsg = '📦 *NOVO PEDIDO RECEBIDO!* 📦\n\n' + adminMsg;
            await client.sendMessage(`${config.adminPhone}@c.us`, adminMsg);
        } catch (error) {
            console.error('Erro ao enviar notificação para admin:', error);
        }
    }
    
    // Reseta estado
    tempOrders[phone] = {
        state: ORDER_STATES.IDLE,
        items: [],
        currentItem: null,
        customerName: '',
        customerPhone: phone,
        deliveryType: '',
        deliveryAddress: '',
        paymentMethod: '',
        total: 0
    };
}

async function sendWelcomeMessage(message) {
    const welcomeMsg = `🍔 *Bem-vindo ao Ratão Lanches!* 🍟\n\n` +
        `O que você gostaria de fazer?\n\n` +
        `📋 *Ver Cardápio* - Envie "ver cardápio"\n` +
        `🛒 *Fazer Pedido* - Envie "fazer pedido"\n\n` +
        `Estamos prontos para te atender!`;
    await message.reply(welcomeMsg);
}

async function sendMenuImage(message) {
    try {
        const imagePath = path.resolve(config.menuImage);
        if (fs.existsSync(imagePath)) {
            const media = MessageMedia.fromFilePath(imagePath);
            await client.sendMessage(message.from, media, { 
                caption: '📋 *Cardápio Ratão Lanches* 📋\n\nEnvie "fazer pedido" para começar seu pedido!'
            });
        } else {
            console.error('Arquivo de imagem não encontrado:', imagePath);
            await message.reply('📋 *Cardápio Ratão Lanches* 📋\n\nA imagem do cardápio não está disponível no momento.');
        }
    } catch (error) {
        console.error('Erro ao enviar imagem do cardápio:', error);
        await message.reply('📋 *Cardápio Ratão Lanches* 📋\n\nOcorreu um erro ao carregar a imagem do cardápio.');
    }
}

async function sendTextMenu(message) {
    let menuText = '🍔 *LANCHES* 🍔\n';
    for (const [item, price] of Object.entries(menu.lanches)) {
        menuText += `\n${item} - R$ ${price.toFixed(2)}`;
    }
    
    menuText += '\n\n🌭 *ADICIONAIS* 🌭';
    for (const [item, price] of Object.entries(menu.adicionais)) {
        menuText += `\n${item} - +R$ ${price.toFixed(2)}`;
    }

    menuText += '\n\n🥤 *REFRIGERANTES* 🥤';
    for (const [item, price] of Object.entries(menu.refrigerantes)) {
        menuText += `\n${item} - R$ ${price.toFixed(2)}`;
    }
    
    menuText += '\n\n🔄 *PERSONALIZAÇÃO* 🔄\nVocê pode remover:';
    menuText += menu.removiveis.map(item => `- Sem ${item}`).join('\n');
    
    menuText += '\n\n💵 *ENTREGA*: R$ 2,00\n🛵 *Retirada no local*: Grátis';
    menuText += '\n\nPara fazer um pedido, envie *"fazer pedido"*';
    
    await message.reply(menuText);
}

async function sendMenuOptions(message, customMessage = null) {
    const items = [
        ...Object.keys(menu.lanches),
        ...Object.keys(menu.refrigerantes)
    ].map((item, i) => `${i+1} - ${item} (R$ ${(menu.lanches[item] || menu.refrigerantes[item]).toFixed(2)})`).join('\n');
    await message.reply(`${customMessage || 'Escolha um lanche ou refrigerante do cardápio:'}\n\n${items}\n\n*Exemplo:* "1" ou "x-salada" ou "coca cola lata"\nOu digite vários separados por vírgula: "1,2,3" ou "coca cola lata, guarana lata"\n\nOu digite *finalizar* para prosseguir.`);
}

async function sendCustomizationOptions(message, itemName, customMessage = null) {
    await message.reply(`${customMessage || `Personalizando ${itemName}:\n\nO que deseja fazer?`}\n\n1️⃣ Remover ingrediente\n2️⃣ Adicionar ingrediente\n3️⃣ Confirmar (sem personalização)\n4️⃣ Pular personalização\n\n*Responda com o número ou nome da opção*\n*Exemplo:* "1" ou "remover"`);
}

async function sendOrderSummary(message, order) {
    let summary = '📋 *RESUMO DO PEDIDO* 📋\n\n';
    summary += `👤 *Cliente:* ${order.customerName}\n`;
    summary += '🍽️ *Itens:*\n';
    
    order.items.forEach(item => {
        summary += `- ${item.quantity}x ${item.name} - R$ ${item.price.toFixed(2)}\n`;
        if (item.removals.length > 0) {
            summary += `  🚫 Sem: ${item.removals.join(', ')}\n`;
        }
        if (item.additions.length > 0) {
            summary += `  ➕ Adicionais: ${item.additions.join(', ')}\n`;
        }
    });
    
    summary += `\n🚚 *Tipo de Entrega:* ${order.deliveryType}`;
    if (order.deliveryType === 'Entrega') {
        summary += ` (Taxa: R$ ${config.deliveryFee.toFixed(2)})`;
    }
    summary += `\n🏠 *Endereço:* ${order.deliveryAddress}\n`;
    summary += `💳 *Pagamento:* ${order.paymentMethod}\n`;
    if (order.paymentMethod === 'Dinheiro' && order.change !== undefined) {
        summary += `💰 *Valor pago:* R$ ${(order.total + order.change).toFixed(2)}\n`;
        summary += `💰 *Troco:* R$ ${order.change.toFixed(2)}\n`;
    }
    summary += `💰 *Total: R$ ${order.total.toFixed(2)}*\n\n`;
    summary += 'Por favor, confirme se está tudo certo respondendo *sim* ou *não*.';
    
    await message.reply(summary);
}

function findMenuItem(input) {
    const lowerInput = input.toLowerCase();
    const menuItems = [
        ...Object.entries(menu.lanches),
        ...Object.entries(menu.refrigerantes)
    ];
    const index = parseInt(input) - 1;
    if (!isNaN(index) && index >= 0 && index < menuItems.length) {
        return {
            name: menuItems[index][0],
            price: menuItems[index][1]
        };
    }
    for (const [name, price] of menuItems) {
        if (name.toLowerCase().includes(lowerInput)) {
            return { name, price };
        }
    }
    return null;
}

function findAdditional(input) {
    const lowerInput = input.toLowerCase();
    const additionalItems = Object.entries(menu.adicionais);
    
    const index = parseInt(input) - 1;
    if (!isNaN(index) && index >= 0 && index < additionalItems.length) {
        return {
            name: additionalItems[index][0],
            price: additionalItems[index][1]
        };
    }
    
    for (const [name, price] of additionalItems) {
        if (name.toLowerCase().includes(lowerInput)) {
            return { name, price };
        }
    }
    
    return null;
}

function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1).toLowerCase();
}

// Inicia o cliente com tratamento de erros
async function initializeClient() {
    try {
        await client.initialize();
        console.log('Cliente inicializado com sucesso!');
    } catch (error) {
        console.error('Erro ao iniciar cliente:', error);
        // Limpa sessões corrompidas
        fs.rmSync(config.sessionPath, { recursive: true, force: true });
        // Tenta novamente após 5 segundos
        setTimeout(initializeClient, 5000);
    }
}

// Inicializa o cliente
initializeClient();

// Inicia o servidor web
server.listen(3000, () => {
    console.log('Servidor web rodando na porta 3000');
});

// Tratamento de erros globais
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});