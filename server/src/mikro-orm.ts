import { MikroORM } from "@mikro-orm/mysql";

const orm = await MikroORM.init();

export default orm;
