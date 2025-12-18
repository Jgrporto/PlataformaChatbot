# APIsTV

Passo a passo para instalar, configurar e rodar os scripts. Inclui a lógica de cada fluxo para facilitar ajustes.

## 1) Instalação
- Requisitos: Node.js 18+ e npm; acesso a `painel.newbr.top`, `botbot.chat`, `gerenciaapp.top`.
- Instale dependências:
  ```bash
  npm install
  ```
  Se o download do Chromium falhar, use `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1` e defina `PUPPETEER_EXECUTABLE_PATH` apontando para um Chrome/Chromium instalado.

## 2) O que configurar
- BotBot e números: `server.js`, `send.js`, `listener.js`, `filterAndSend.js`, `autoAssist.js` (appkey/authkey, números de destino).
- WhatsApp QR: `KEYWORD` e `DEVICE_PHONE` em `whatsappQrListener.js`; sessão fica em `.wwebjs_auth`.
- GerenciaApp: `GERENCIA_USER`, `GERENCIA_PASS` e `FORM_DATA` em `gerenciaApp.js`.
- Números de teste/destino: `sendNewBR.js`, `filterAndSend.js`, `autoAssist.js`, `listener.js`, `server.js`.

## 3) Fluxos principais
- `server.js` (webhook + automação inicial):
  - Sobe em `PORT` (padrão 3000) com `POST /webhook` esperando `{ from, message }`.
  - Se recebe `ASSIST`, gera teste na API NewBR, filtra bloco `ASSIST PLUS` e responde via BotBot.
  - Na inicialização, gera um teste, extrai M3U e cadastra no GerenciaApp via `criarUsuarioGerenciaAppComM3u`; envia mensagem de sucesso.
- `whatsappQrListener.js` (WhatsApp Web + OCR de MAC):
  - Primeiro run: mostra QR no terminal; após parear, reusa sessão.
  - Texto igual a `KEYWORD`: gera teste na NewBR, extrai M3U e cria usuário no GerenciaApp.
  - Imagens: baixa mídia, roda OCR (`tesseract.js`) e procura MAC (XX:XX:XX:XX:XX:XX ou 12 hex). Se achar, responde com o MAC.
- `gerenciaApp.js` (Puppeteer):
  - Faz login no GerenciaApp e preenche o formulário de criação de usuário via labels (`fillByLabel`), depois envia.
- `listener.js` (polling BotBot):
  - Busca mensagens recebidas; responde apenas ao número admin com comando `ASSIST`.
  - Gera teste, filtra `ASSIST PLUS` e envia via BotBot. Ignora histórico inicial para evitar duplicar.
- `autoAssist.js` (simples):
  - Recebe `ASSIST` do admin e devolve o bloco filtrado `ASSIST PLUS`.
- `filterAndSend.js`:
  - Dispara um teste, filtra `ASSIST PLUS` e envia para `NUMERO_DESTINO`.
- Exemplos:
  - `send.js`: envia mensagem fixa via BotBot.
  - `sendNewBR.js`: chama API NewBR e imprime resposta.

## 4) Como rodar
- Servidor principal (webhook + automação inicial):
  ```bash
  node server.js
  ```
- Listener WhatsApp com OCR:
  ```bash
  node whatsappQrListener.js
  ```
  Escaneie o QR; envie `KEYWORD` ou imagem com MAC para testar.
- Outros: execute o script desejado (`node listener.js`, `node autoAssist.js`, `node filterAndSend.js`, etc.).

## 5) Testes rápidos
- Webhook local:
  ```bash
  curl -X POST http://localhost:3000/webhook ^
    -H "Content-Type: application/json" ^
    -d "{\"from\":\"5524999999999\",\"message\":\"ASSIST\"}"
  ```
- OCR/MAC: com `whatsappQrListener.js` pareado, envie uma foto com MAC legível; o bot deve responder `MAC detectado: ...`.

## 6) Observações
- Se Puppeteer ou Tesseract não baixarem assets por bloqueio de rede, aponte para binários/dados locais (`PUPPETEER_EXECUTABLE_PATH`, `TESSDATA_PREFIX`) ou rode em máquina com acesso liberado.
- Ajuste chaves e números antes de usar em produção; os valores no código são placeholders de teste.


## 7) Variaveis para o Railway
- GERENCIA_USER / GERENCIA_PASS / GERENCIA_LOGIN_URL / GERENCIA_CREATE_URL: credenciais e URLs do GerenciaApp.
- BOTBOT_APPKEY / BOTBOT_AUTHKEY: chaves do bot (substitua os valores hardcoded).
- DEVICE_PHONE: numero conectado ao BotBot/WhatsApp.
- PUPPETEER_SKIP_CHROMIUM_DOWNLOAD (opcional): defina 1 se for usar Chromium do sistema; combine com PUPPETEER_EXECUTABLE_PATH.
- TESSDATA_PREFIX (opcional): caminho do eng.traineddata se nao usar o arquivo local.
