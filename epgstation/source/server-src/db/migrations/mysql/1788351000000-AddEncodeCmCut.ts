import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddEncodeCmCut1788351000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumns('reserve', [
            new TableColumn({
                name: 'encodeCmCut1',
                type: 'tinyint',
                width: 1,
                default: 0,
            }),
            new TableColumn({
                name: 'encodeCmCut2',
                type: 'tinyint',
                width: 1,
                default: 0,
            }),
            new TableColumn({
                name: 'encodeCmCut3',
                type: 'tinyint',
                width: 1,
                default: 0,
            }),
        ]);

        await queryRunner.addColumns('rule', [
            new TableColumn({
                name: 'cmCut1',
                type: 'tinyint',
                width: 1,
                default: 0,
            }),
            new TableColumn({
                name: 'cmCut2',
                type: 'tinyint',
                width: 1,
                default: 0,
            }),
            new TableColumn({
                name: 'cmCut3',
                type: 'tinyint',
                width: 1,
                default: 0,
            }),
        ]);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn('reserve', 'encodeCmCut1');
        await queryRunner.dropColumn('reserve', 'encodeCmCut2');
        await queryRunner.dropColumn('reserve', 'encodeCmCut3');

        await queryRunner.dropColumn('rule', 'cmCut1');
        await queryRunner.dropColumn('rule', 'cmCut2');
        await queryRunner.dropColumn('rule', 'cmCut3');
    }
}
