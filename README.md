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

## Observacoes
- `whatsappQrListener.js` permanece como entrypoint legado e apenas importa `src/server.js`.
- Migrations SQLite rodam automaticamente ao iniciar.
