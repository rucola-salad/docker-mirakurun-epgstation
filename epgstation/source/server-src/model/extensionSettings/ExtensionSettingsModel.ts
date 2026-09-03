import * as fs from 'fs';
import { injectable } from 'inversify';
import * as path from 'path';
import * as apid from '../../../api';
import IExtensionSettingsModel from './IExtensionSettingsModel';

@injectable()
export default class ExtensionSettingsModel implements IExtensionSettingsModel {
    private static readonly SETTINGS_PATH = path.join(__dirname, '..', '..', '..', 'data', 'extension-settings.json');

    private getDefaultSettings(): apid.ExtensionSettings {
        return {
            autoGenerateJikkyoXml: true,
        };
    }

    public async get(): Promise<apid.ExtensionSettings> {
        const defaults = this.getDefaultSettings();

        try {
            const text = await fs.promises.readFile(ExtensionSettingsModel.SETTINGS_PATH, 'utf-8');
            const value = JSON.parse(text);

            return {
                autoGenerateJikkyoXml:
                    typeof value.autoGenerateJikkyoXml === 'boolean'
                        ? value.autoGenerateJikkyoXml
                        : defaults.autoGenerateJikkyoXml,
            };
        } catch (err: any) {
            if (err.code === 'ENOENT') {
                return defaults;
            }

            throw err;
        }
    }

    public async update(settings: apid.ExtensionSettings): Promise<apid.ExtensionSettings> {
        if (typeof settings.autoGenerateJikkyoXml !== 'boolean') {
            throw new Error('autoGenerateJikkyoXml must be boolean');
        }

        const value: apid.ExtensionSettings = {
            autoGenerateJikkyoXml: settings.autoGenerateJikkyoXml,
        };

        const dir = path.dirname(ExtensionSettingsModel.SETTINGS_PATH);
        await fs.promises.mkdir(dir, { recursive: true });

        const tmpPath = `${ExtensionSettingsModel.SETTINGS_PATH}.${process.pid}.tmp`;

        try {
            await fs.promises.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
            await fs.promises.rename(tmpPath, ExtensionSettingsModel.SETTINGS_PATH);
        } catch (err) {
            try {
                await fs.promises.unlink(tmpPath);
            } catch (_) {
                // ignore
            }

            throw err;
        }

        return value;
    }
}
