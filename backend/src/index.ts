import { MongoClient } from "mongodb";
import { createChatServer } from "./server.js";

const main = async (): Promise<void> => {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error("A variável MONGODB_URI é obrigatória.");
  }

  const adminApiToken = process.env.ADMIN_API_TOKEN;

  if (!adminApiToken || adminApiToken.length < 32) {
    throw new Error("ADMIN_API_TOKEN deve ter pelo menos 32 caracteres.");
  }

  const client = new MongoClient(uri);

  await client.connect();

  const db = client.db(process.env.MONGO_DATABASE);
  const application = await createChatServer(db, { adminApiToken });
  const port = Number(process.env.PORT);

  application.httpServer.listen(port, () => {
    console.log(`Bate-papo disponível na porta ${port}`);
  });

  const shutdown = (): void => {
    void application.close().finally(() => client.close());
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
};

await main();
