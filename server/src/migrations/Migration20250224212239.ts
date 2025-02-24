import { Migration } from "@mikro-orm/migrations";

export class Migration20250224212239 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table \`chat_room\` (\`id\` int unsigned not null auto_increment primary key, \`created_at\` DATETIME(3) not null, \`name\` varchar(50) not null) default character set utf8mb4 engine = InnoDB;`
    );

    this.addSql(
      `create table \`chat_message\` (\`id\` int unsigned not null auto_increment primary key, \`date_time\` DATETIME(3) not null, \`message\` varchar(500) not null, \`sender\` varchar(20) not null, \`receiver\` varchar(20) null, \`private\` tinyint(1) not null default false, \`room_id\` int unsigned not null) default character set utf8mb4 engine = InnoDB;`
    );
    this.addSql(
      `alter table \`chat_message\` add index \`chat_message_room_id_index\`(\`room_id\`);`
    );

    this.addSql(
      `alter table \`chat_message\` add constraint \`chat_message_room_id_foreign\` foreign key (\`room_id\`) references \`chat_room\` (\`id\`) on update cascade;`
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table \`chat_message\` drop foreign key \`chat_message_room_id_foreign\`;`
    );

    this.addSql(`drop table if exists \`chat_room\`;`);

    this.addSql(`drop table if exists \`chat_message\`;`);
  }
}
