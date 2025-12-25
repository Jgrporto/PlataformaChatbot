# Plataforma Chatbot +TV

Painel admin web + WhatsApp bot com persistencia local (SQLite) e atualizacao em tempo real via WebSocket.

## Requisitos
- Node.js 18+
- acesso a `painel.newbr.top` e `gerenciaapp.top`

## Instalacao
```bash
npm install
```

## Como rodar
```bash
npm run dev
```

Ou em producao:
```bash
npm start
```

Acesse:
- Painel: http://localhost:3200/admin
- QR legado: http://localhost:3200/qr

## Rodar 24/7 no VPS (systemd)
1) Compile o painel admin (em producao o servidor serve `admin/dist`):
```bash
npm install
npm run build:admin
```

2) Instale o service e ajuste caminhos/usuario:
```bash
sudo cp deploy/systemd/tvbot.service /etc/systemd/system/tvbot.service
sudo nano /etc/systemd/system/tvbot.service
```

Exemplo de `tvbot.service`:
```ini
[Unit]
Description=+TV Bot
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/PlataformaChatbot
ExecStart=/root/.nvm/versions/node/v20.19.6/bin/node /root/PlataformaChatbot/src/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3200
# EnvironmentFile=/etc/tvbot.env

[Install]
WantedBy=multi-user.target
```

Notas:
- Se **nao** usa nvm, ajuste `ExecStart` para o node do sistema (ex: `/usr/bin/node`).
- Para variaveis de ambiente, use `EnvironmentFile=/etc/tvbot.env`.

3) Ative o servico:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tvbot
```

## Operacao no VPS
```bash
sudo systemctl start tvbot
sudo systemctl stop tvbot
sudo systemctl restart tvbot
sudo systemctl status tvbot
journalctl -u tvbot -f
```

Dica: apos `git pull` ou alteracoes de codigo, rode `npm run build:admin` e reinicie o servico.

## Variaveis de ambiente
- `ADMIN_USER` / `ADMIN_PASS`: login do painel
- `SESSION_SECRET`: segredo da session
- `PORT`: porta do servidor (padrao 3200)
- `SESSION_NAMES`: nomes das sessoes separadas por virgula (ex: "Venda 1,Venda 2")
- `DEVICE_PHONE`: numero do dispositivo principal (E.164)
- `FOLLOWUP_MS`: atraso do follow-up (ms)
- `FOLLOWUP_STORAGE_PATH`: caminho do JSON de follow-ups
- `DB_PATH`: caminho do SQLite (padrao `data/app.db`)
- `WWEB_AUTH_PATH`: pasta de auth do whatsapp-web.js (padrao `.wwebjs_auth`)

## Arquitetura
- `src/server.js`: Express + WebSocket + rotas
- `src/bot/`: WhatsApp sessions e processamento de mensagens
- `src/api/`: endpoints REST do painel
- `src/db/`: SQLite + migrations + repositorios
- `src/realtime/`: WebSocket
- `admin/`: SPA estatica (HTML/CSS/JS)
- `data/app.db`: SQLite (criado automaticamente)

## Endpoints principais
Auth:
- `POST /api/login`
- `POST /api/logout`
- `GET /api/me`

Devices:
- `POST /api/devices`
- `GET /api/devices`
- `GET /api/devices/:id/qr`
- `POST /api/devices/:id/reconnect`
- `DELETE /api/devices/:id`

Chatbot:
- `GET /api/chatbot/commands`
- `POST /api/chatbot/commands`
- `PUT /api/chatbot/commands/:id`
- `DELETE /api/chatbot/commands/:id`
- `GET /api/chatbot/quick-replies`
- `POST /api/chatbot/quick-replies`
- `PUT /api/chatbot/quick-replies/:id`
- `DELETE /api/chatbot/quick-replies/:id`
- `GET /api/chatbot/variables`
- `POST /api/chatbot/variables`
- `PUT /api/chatbot/variables/:id`
- `DELETE /api/chatbot/variables/:id`
- `GET /api/chatbot/flows`
- `POST /api/chatbot/flows`
- `PUT /api/chatbot/flows/:id`
- `DELETE /api/chatbot/flows/:id`

Interacoes:
- `GET /api/interactions?from=&to=&q=&deviceId=`
- `GET /api/contacts/:phone/history`

Testes:
- `GET /api/tests?status=&from=&to=&deviceId=`
- `GET /api/tests/:id`

Compatibilidade:
- `GET /api/commands`
- `GET /api/commands/flows`
- `GET /qr`

## Realtime
WebSocket em `ws://<host>/ws` com eventos:
- `device.created`, `device.updated`, `device.reconnected`, `device.removed`, `device.activity`
- `interaction.new`
- `message.new`

## Variaveis personalizadas
Crie variaveis no painel (aba "Variaveis") e use nos textos de comandos #, respostas rapidas e flows.

Formato do token:
- `{#nome_da_variavel}`

Regras:
- Apenas letras, numeros e `_`.
- O nome e normalizado para minusculas no servidor.
- O nome deve ser unico no sistema (nao e permitido duplicar por device).

Variaveis pre-criadas (sistema):
- `{#nome}`: nome do contato (WhatsApp).
- `{#telefone}`: telefone do contato (E.164).
- `{#usuario}`: usuario extraido do retorno do NewBR.
- `{#senha}`: senha extraida do retorno do NewBR.
- `{#http1}`: primeiro link HTTP encontrado no retorno do NewBR.
- `{#http2}`: segundo link HTTP encontrado no retorno do NewBR.

Obs: o painel alerta ao tentar sobrescrever variaveis do sistema.

Exemplo:
```
Nome: {#nome}
Usuario: {#usuario}
Senha: {#senha}
Http: {#http}
```

## Observacoes
- `whatsappQrListener.js` permanece como entrypoint legado e apenas importa `src/server.js`.
- Migrations SQLite rodam automaticamente ao iniciar.
