# Bate-papo

[Read this README in English](README.en.md).

Aplicativo de chat em salas com interface em português do Brasil, React, Socket.io e MongoDB.

## Desenvolvimento

Copie `.env.example` para `.env` na primeira execução. Instale as dependências nos diretórios montados do host:

```sh
docker compose run --build --rm --no-deps backend npm install
docker compose run --build --rm --no-deps frontend npm install
```

Depois execute `docker compose up --build` e abra http://localhost:8080. Os bind mounts recarregam backend e frontend quando os arquivos mudam. `node_modules` fica nas pastas locais `backend/` e `frontend/`, ignoradas pelo Git; por isso a instalação é feita explicitamente pelo comando `docker compose run`.

O endpoint administrativo de conversas exige `Authorization: Bearer <ADMIN_API_TOKEN>`. O backend exige que `ADMIN_API_TOKEN` tenha pelo menos 32 caracteres.

## Produção

Execute `docker compose -f prod.docker-compose.yml up --build`. As imagens compilam o frontend e backend sem bind mounts. O Nginx encaminha `/api` e `/socket.io` ao backend.

## Testes e cobertura

Com os serviços de desenvolvimento ativos, execute:

```sh
docker compose exec backend npm test
docker compose exec backend npm run test:coverage
docker compose exec frontend npm test
docker compose exec frontend npm run test:coverage
```

Vitest cobre as regras de servidor e os estados da interface com o provedor V8; os relatórios HTML aparecem em `backend/coverage/` e `frontend/coverage/`. Os testes end-to-end do Playwright usam Chromium real. Para executá-los dentro da imagem oficial do Playwright, com o Compose ativo:

```sh
docker run --rm --network chat_default \
  -e PLAYWRIGHT_BASE_URL=http://frontend:5173 \
  -v "$PWD/frontend:/app" -w /app \
  mcr.microsoft.com/playwright:v1.63.0-noble npm run test:e2e
```

O Playwright cobre entrada, nick duplicado, envio por Enter, mensagens públicas e reservadas, presença ao vivo, modo espiar (incluindo reload), retorno para Todos quando o destinatário sai e retomada de participante sem histórico. Os testes de backend usam MongoDB e Socket.io reais para validar também regras e rejeições de servidor.

Lint e formatação podem ser verificados em cada serviço com `npm run lint` e `npm run format:check`.

## Regras de servidor e operação

- Apelidos não podem conter caracteres de controle nem invisíveis (como espaço de largura zero).
- O envio de mensagens é limitado a 5 por sessão a cada 5 segundos; acima disso o servidor responde com erro.
- Se a mesma sessão for aberta em outra aba ou janela (por exemplo, ao duplicar a aba), a aba anterior é desconectada, mostra um aviso e volta para a lista de salas.
- O compose de produção (`prod.docker-compose.yml`) não publica as portas do MongoDB nem do backend; todo acesso externo passa pelo Nginx do frontend.
- `PORT` assume 3000 quando ausente. Os eventos de saída gerados na inicialização para sessões abandonadas usam o horário da última atividade conhecida da sessão.

## Arquitetura

Monorepo TypeScript strict. O backend Node 24 LTS é a autoridade para presença, validação e entrega privada. O MongoDB registra sessões e mensagens; a UI não lê histórico. O frontend usa Vite, React, Tailwind CSS v4 pelo plugin oficial do Vite e Socket.io Client. Um proxy no Vite em desenvolvimento e no Nginx em produção encaminha API e WebSocket; o navegador usa a mesma origem e o backend não precisa de CORS.
