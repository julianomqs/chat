import { expect, test, type Page } from "@playwright/test";

const enterRoom = async (
  page: Page,
  nick: string,
  roomName = "Papo Livre",
  color = "#3658d4"
): Promise<void> => {
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(roomName) }).click();
  await page.getByLabel("Seu apelido").fill(nick);
  await page.getByLabel("Cor do apelido").fill(color);
  await page.getByRole("button", { name: /Entrar na sala/ }).click();
  await expect(
    page.getByRole("heading", { name: /Participantes/ })
  ).toBeVisible();
};

test("entrada, duplicidade de nick e seleção padrão Todos", async ({
  page
}) => {
  await enterRoom(page, "E2E Alice");

  const everyone = page.getByRole("button", { name: /Todos/ });
  const privateCheckbox = page.getByRole("checkbox");

  await expect(everyone).toBeVisible();
  await expect(privateCheckbox).toBeDisabled();
  await expect(privateCheckbox).not.toBeChecked();

  const duplicatePage = await page.context().newPage();

  await duplicatePage.goto("/");
  await duplicatePage.getByRole("button", { name: /Papo Livre/ }).click();
  await duplicatePage.getByLabel("Seu apelido").fill("e2e alice");
  await duplicatePage.getByRole("button", { name: /Entrar na sala/ }).click();
  await expect(duplicatePage.getByText(/apelido já está em uso/)).toBeVisible();

  await duplicatePage.getByLabel("Seu apelido").fill("Todos");
  await duplicatePage.getByRole("button", { name: /Entrar na sala/ }).click();
  await expect(
    duplicatePage.getByText(/apelido não está disponível/)
  ).toBeVisible();

  await duplicatePage.getByLabel("Seu apelido").fill("");
  await duplicatePage.getByRole("button", { name: /Entrar na sala/ }).click();
  await expect(
    duplicatePage.getByText(/entre 1 e 20 caracteres/)
  ).toBeVisible();

  await duplicatePage.close();
  await page.getByRole("button", { name: "Sair da sala" }).click();
});

test("entrega reservada só aos participantes e pública também ao espião", async ({
  page
}) => {
  await enterRoom(page, "E2E Alice Privada", "Música", "#123ABC");

  const bruno = await page.context().newPage();
  const carla = await page.context().newPage();
  const spy = await page.context().newPage();

  await enterRoom(bruno, "E2E Bruno Privado", "Música");
  await enterRoom(carla, "E2E Carla Privada", "Música");
  await spy.goto("/");
  await spy.getByRole("button", { name: /Música/ }).click();
  await spy.getByRole("button", { name: /Espiar em silêncio/ }).click();
  await expect(spy.getByText("Modo espiar", { exact: true })).toBeVisible();
  await expect(spy.getByLabel("Mensagem")).toHaveCount(0);

  expect(
    await page.locator(".people-list .person-name").allTextContents()
  ).toEqual([
    "E2E Alice Privada",
    "Todos",
    "E2E Bruno Privado",
    "E2E Carla Privada"
  ]);
  await expect(page.locator(".person-self .person-name")).toHaveCSS(
    "color",
    "rgb(18, 58, 188)"
  );

  await page.getByRole("button", { name: /E2E Bruno Privado/ }).click();

  const privateCheckbox = page.getByRole("checkbox");

  await expect(privateCheckbox).toBeEnabled();
  await expect(privateCheckbox).toBeChecked();
  await page.getByLabel("Mensagem").fill("segredo e2e");
  await page.getByRole("button", { name: /Enviar/ }).click();
  await expect(page.getByText(/segredo e2e/)).toBeVisible();
  await expect(
    page.locator(".message-row").filter({ hasText: "segredo e2e" })
  ).toContainText("reservadamente disse a E2E Bruno Privado: segredo e2e");
  await expect(bruno.getByText(/segredo e2e/)).toBeVisible();
  await expect(carla.getByText(/segredo e2e/)).toHaveCount(0);
  await expect(spy.getByText(/segredo e2e/)).toHaveCount(0);

  await privateCheckbox.uncheck();
  await page.getByLabel("Mensagem").fill("aviso público e2e");
  await page.getByRole("button", { name: /Enviar/ }).click();
  await expect(
    page.locator(".message-row").filter({ hasText: "aviso público e2e" })
  ).toContainText("disse a E2E Bruno Privado: aviso público e2e");
  await expect(bruno.getByText(/aviso público e2e/)).toBeVisible();
  await expect(carla.getByText(/aviso público e2e/)).toBeVisible();
  await expect(spy.getByText(/aviso público e2e/)).toBeVisible();

  await Promise.all([bruno.close(), carla.close(), spy.close()]);
  await page.getByRole("button", { name: "Sair da sala" }).click();
});

test("reload restaura a sala e o destinatário sem recuperar mensagens", async ({
  page
}) => {
  await enterRoom(page, "E2E Recarrega", "Esportes");

  const recipient = await page.context().newPage();

  await enterRoom(recipient, "E2E Destinatário", "Esportes");
  await page.getByRole("button", { name: /E2E Destinatário/ }).click();
  await page.getByLabel("Mensagem").fill("mensagem antes do reload");
  await page.getByRole("button", { name: /Enviar/ }).click();
  await expect(page.getByText(/mensagem antes do reload/)).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("heading", { name: /Participantes/ })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /E2E Destinatário/ })
  ).toBeVisible();
  await expect(page.getByText("O papo começa agora")).toBeVisible();
  await expect(page.getByText(/mensagem antes do reload/)).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toBeChecked();

  await recipient.close();
  await page.getByRole("button", { name: "Sair da sala" }).click();
});

test("atualiza contagem ao vivo, exclui espiões e mostra entrada e saída ao espião", async ({
  page
}) => {
  await enterRoom(page, "E2E Presença", "Cinema");

  const lobby = await page.context().newPage();

  await lobby.goto("/");
  await expect(
    lobby.getByRole("button", { name: /Cinema/ }).locator(".room-count")
  ).toHaveText("1");

  const spy = await page.context().newPage();

  await spy.goto("/");
  await spy.getByRole("button", { name: /Cinema/ }).click();
  await spy.getByRole("button", { name: /Espiar em silêncio/ }).click();
  await expect(spy.getByText("Modo espiar", { exact: true })).toBeVisible();
  await expect(
    lobby.getByRole("button", { name: /Cinema/ }).locator(".room-count")
  ).toHaveText("1");

  const otherParticipant = await page.context().newPage();

  await enterRoom(otherParticipant, "E2E Visitante", "Cinema");
  await expect(spy.getByText("entrou no chat").last()).toBeVisible();
  await expect(
    lobby.getByRole("button", { name: /Cinema/ }).locator(".room-count")
  ).toHaveText("2");

  await spy.reload();
  await expect(spy.getByText("Modo espiar", { exact: true })).toBeVisible();
  await expect(spy.getByLabel("Mensagem")).toHaveCount(0);

  await otherParticipant.getByRole("button", { name: "Sair da sala" }).click();
  await expect(spy.getByText("saiu do chat").last()).toBeVisible();
  await expect(
    lobby.getByRole("button", { name: /Cinema/ }).locator(".room-count")
  ).toHaveText("1");

  await page.getByRole("button", { name: "Sair da sala" }).click();
  await expect(spy.getByText("saiu do chat").last()).toBeVisible();
  await expect(
    lobby.getByRole("button", { name: /Cinema/ }).locator(".room-count")
  ).toHaveText("0");

  await Promise.all([otherParticipant.close(), lobby.close(), spy.close()]);
});

test("envia com Enter e redefine para Todos quando o destinatário sai", async ({
  page
}) => {
  await enterRoom(page, "E2E Remetente", "Amizade");

  const recipient = await page.context().newPage();

  await enterRoom(recipient, "Destinatário sai", "Amizade");
  await page.getByRole("button", { name: /Destinatário sai/ }).click();

  const checkbox = page.getByRole("checkbox", { name: /Reservadamente/ });

  await expect(checkbox).toBeEnabled();
  await expect(checkbox).toBeChecked();

  await recipient.getByRole("button", { name: "Sair da sala" }).click();
  await expect(
    page.getByRole("button", { name: /Destinatário sai/ })
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Todos/ })).toHaveClass(
    /person-selected/
  );
  await expect(checkbox).toBeDisabled();
  await expect(checkbox).not.toBeChecked();

  const message = page.getByLabel("Mensagem");

  await message.fill("enviado com Enter");
  await message.press("Enter");
  await expect(page.getByText(/enviado com Enter/)).toBeVisible();
  await expect(
    page.locator(".message-row").filter({ hasText: "enviado com Enter" })
  ).toContainText("disse a Todos: enviado com Enter");

  await page.getByRole("button", { name: "Sair da sala" }).click();
});

test("não recupera mensagem reservada enviada enquanto o destinatário está desconectado", async ({
  browser,
  page
}) => {
  await enterRoom(page, "E2E Remetente Online", "Tecnologia");

  const recipientContext = await browser.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:8080"
  });
  const recipient = await recipientContext.newPage();

  await enterRoom(recipient, "E2E Offline", "Tecnologia");
  await expect(page.getByRole("button", { name: /E2E Offline/ })).toBeVisible();
  await recipientContext.setOffline(true);
  await expect(recipient.getByText("Reconectando")).toBeVisible();

  await page.getByRole("button", { name: /E2E Offline/ }).click();
  await page.getByLabel("Mensagem").fill("mensagem durante a queda");
  await page.getByRole("button", { name: /Enviar/ }).click();
  await expect(page.getByText(/mensagem durante a queda/)).toBeVisible();

  await recipientContext.setOffline(false);
  await expect(recipient.getByText("Conectado")).toBeVisible();
  await expect(recipient.getByText(/mensagem durante a queda/)).toHaveCount(0);

  await recipient.getByRole("button", { name: "Sair da sala" }).click();
  await page.getByRole("button", { name: "Sair da sala" }).click();
  await recipientContext.close();
});

test("token inválido rejeitado pelo servidor retorna à tela de salas", async ({
  page
}) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("batepapo:session", "token-que-nao-existe");
  });
  await page.goto("/");

  await expect(page.getByRole("alert")).toHaveText(
    "Sessão inválida ou expirada."
  );
  await expect(page.getByRole("button", { name: /Papo Livre/ })).toBeVisible();
  expect(
    await page.evaluate(() => sessionStorage.getItem("batepapo:session"))
  ).toBeNull();
});

test("aba duplicada não deixa a aba original travada", async ({ page }) => {
  await enterRoom(page, "E2E Duplicada", "Esportes");

  const token = await page.evaluate(() =>
    sessionStorage.getItem("batepapo:session")
  );
  const copy = await page.context().newPage();

  await copy.addInitScript((value) => {
    if (value) {
      sessionStorage.setItem("batepapo:session", value);
    }
  }, token);
  await copy.goto("/");
  await expect(
    copy.getByRole("heading", { name: /Participantes/ })
  ).toBeVisible();
  await expect(
    page.getByText("Sua sessão foi aberta em outra aba ou janela.")
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Participantes/ })
  ).toHaveCount(0);

  await copy.getByRole("button", { name: "Sair da sala" }).click();
});
