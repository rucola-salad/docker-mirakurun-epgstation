import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVideoFileCmState1788350000000 implements MigrationInterface {
    public name = 'AddVideoFileCmState1788350000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            "ALTER TABLE `video_file` ADD `cmState` varchar(16) NOT NULL DEFAULT 'uncut'",
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            'ALTER TABLE `video_file` DROP COLUMN `cmState`',
        );
    }
}
