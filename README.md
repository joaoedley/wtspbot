# Bot de Pedidos para Restaurante

Este é um bot de WhatsApp desenvolvido para automatizar pedidos de um restaurante. O bot permite que os clientes visualizem o cardápio, façam pedidos e escolham opções de pagamento.

## Funcionalidades

- Visualização do cardápio
- Escolha de múltiplos itens
- Seleção de refrigerantes
- Geração de QR Code para pagamento
- Opções de pagamento (PIX, dinheiro, cartão)
- Cálculo de troco
- Confirmação de pedido

## Requisitos

- Node.js
- NPM
- WhatsApp Web
- Conta no GitHub

## Instalação

1. Clone o repositório:
```bash
git clone [URL_DO_SEU_REPOSITÓRIO]
```

2. Instale as dependências:
```bash
npm install
```

3. Configure o arquivo `config.js` com suas credenciais:
```javascript
module.exports = {
    numero: 'SEU_NUMERO_AQUI',
    // outras configurações
};
```

4. Inicie o bot:
```bash
node index.js
```

## Como Usar

1. Envie "ver cardápio" para ver as opções disponíveis
2. Escolha os itens digitando seus números
3. Selecione o refrigerante
4. Escolha a forma de pagamento
5. Confirme seu pedido

## Contribuição

Sinta-se à vontade para contribuir com o projeto através de pull requests.

## Licença

Este projeto está sob a licença MIT.
