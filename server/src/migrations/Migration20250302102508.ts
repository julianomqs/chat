import { Migration } from "@mikro-orm/migrations";

export class Migration20250302102508 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table \`chat_message\` add \`deleted\` tinyint(1) not null default false;`
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table \`chat_message\` drop column \`deleted\`;`);
  }
}
