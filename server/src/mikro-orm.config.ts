import { Migrator } from "@mikro-orm/migrations";
import { defineConfig, MySqlDriver } from "@mikro-orm/mysql";
import { TsMorphMetadataProvider } from "@mikro-orm/reflection";

export default defineConfig({
  driver: MySqlDriver,
  dbName: process.env.DB_DATABASE,
  host: "db",
  port: 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  entities: ["build/**/*.entity.js"],
  entitiesTs: ["src/**/*.entity.ts"],
  metadataProvider: TsMorphMetadataProvider,
  debug: true,
  extensions: [Migrator]
});
