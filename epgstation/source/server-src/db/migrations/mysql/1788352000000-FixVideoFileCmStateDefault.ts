import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixVideoFileCmStateDefault1788352000000
    implements MigrationInterface
{
    public name = 'FixVideoFileCmStateDefault1788352000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            "ALTER TABLE `video_file` MODIFY `cmState` varchar(16) NOT NULL DEFAULT 'uncut'",
        );
        await queryRunner.query(
            "UPDATE `video_file` SET `cmState` = 'uncut' WHERE `cmState` = 'unknown'",
        );
    }

    public async down(_queryRunner: QueryRunner): Promise<void> {
        // 既存の uncut との区別ができないため、cmState は unknown に戻さない。
    }
}
