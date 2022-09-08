/*!
 * Copyright (c) 2019-2021 TUXEDO Computers GmbH <tux@tuxedocomputers.com>
 *
 * This file is part of TUXEDO Control Center.
 *
 * TUXEDO Control Center is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * TUXEDO Control Center is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with TUXEDO Control Center.  If not, see <https://www.gnu.org/licenses/>.
 */

import * as fs from 'fs';

import { DaemonWorker } from './DaemonWorker';
import { TuxedoControlCenterDaemon } from './TuxedoControlCenterDaemon';
import { KeyboardBacklightColorModes, KeyboardBacklightCapabilitiesInterface, KeyboardBacklightStateInterface } from '../../common/models/TccSettings';
import { fileOK, fileOKAsync } from '../../common/classes/Utils';

export class KeyboardBacklightWorker extends DaemonWorker {
    private clevoLedsWhiteOnly: string = "/sys/devices/platform/tuxedo_keyboard/leds/white:kbd_backlight";
    private clevoLedsRGBZones: Array<string> = ["/sys/devices/platform/tuxedo_keyboard/leds/rgb:kbd_backlight",
                                                "/sys/devices/platform/tuxedo_keyboard/leds/rgb:kbd_backlight_1",
                                                "/sys/devices/platform/tuxedo_keyboard/leds/rgb:kbd_backlight_2"];
    private keyboardBacklightCapabilities: KeyboardBacklightCapabilitiesInterface = {} as KeyboardBacklightCapabilitiesInterface;
    private keyboardBacklightStates: Array<KeyboardBacklightStateInterface> = [];
    private keyboardBacklightStatesPendingNewJSON: string = undefined;
    private keyboardBacklightStatesWritingNew: boolean = false;
    private keyboardBacklightStatesUpdating: boolean = false;
    private keyboardBacklightStatesUpdatingReset: NodeJS.Timeout;


    constructor(tccd: TuxedoControlCenterDaemon) {
        super(1500, tccd);
    }

    // Converts Int Value: 0xRRGGBBAA to string value "RRR GGG BBB" (in decimal)
    private rgbaIntToRGBDecString (input: number): string {
        let red = (input >> 24) & 0xff;
        let green = (input >> 16) & 0xff;
        let blue = (input >> 8) & 0xff;
        return red.toString(10) + " " + green.toString(10) + " " + blue.toString(10);
    }

    private getKeyboardBacklightCapabilities(): void {
        this.keyboardBacklightCapabilities = {} as KeyboardBacklightCapabilitiesInterface;

        this.keyboardBacklightCapabilities.modes = [KeyboardBacklightColorModes.static];

        if (fileOK(this.clevoLedsWhiteOnly + "/max_brightness")) {
            this.keyboardBacklightCapabilities.maxBrightness = Number(fs.readFileSync(this.clevoLedsWhiteOnly + "/max_brightness"));
            this.keyboardBacklightCapabilities.zones = 1;
        }
        else {
            if (fileOK(this.clevoLedsRGBZones[0] + "/max_brightness")) {
                this.keyboardBacklightCapabilities.maxBrightness = Number(fs.readFileSync(this.clevoLedsRGBZones[0] + "/max_brightness"));
                this.keyboardBacklightCapabilities.maxRed = 0xff;
                this.keyboardBacklightCapabilities.maxGreen = 0xff;
                this.keyboardBacklightCapabilities.maxBlue = 0xff;
                this.keyboardBacklightCapabilities.zones = 1;
                if (fileOK(this.clevoLedsRGBZones[1] + "/max_brightness")) {
                    this.keyboardBacklightCapabilities.zones++;
                }
                if (fileOK(this.clevoLedsRGBZones[2] + "/max_brightness")) {
                    this.keyboardBacklightCapabilities.zones++;
                }
            }
        }
        this.tccd.dbusData.keyboardBacklightCapabilitiesJSON = JSON.stringify(this.keyboardBacklightCapabilities);
    }

    private async updateSettingsFromValue(keyboardBacklightStatesNew: Array<KeyboardBacklightStateInterface>): Promise<void> {
        this.tccd.settings.keyboardBacklightColorMode = keyboardBacklightStatesNew[0].mode;
        this.tccd.settings.keyboardBacklightBrightness = keyboardBacklightStatesNew[0].brightness;
        this.tccd.settings.keyboardBacklightColor = [];
        for (let i: number = 0; i < this.clevoLedsRGBZones.length ; ++i) {
            this.tccd.settings.keyboardBacklightColor[i] = (keyboardBacklightStatesNew[i].red << 24 >>> 0) +
                                                            (keyboardBacklightStatesNew[i].green << 16 >>> 0) +
                                                            (keyboardBacklightStatesNew[i].blue << 8 >>> 0);
        }
        await this.tccd.config.writeSettingsAsync(this.tccd.settings);
    }

    private async updateKeyboardBacklightStatesFromValue(keyboardBacklightStatesNew: Array<KeyboardBacklightStateInterface>): Promise<void> {
        this.keyboardBacklightStates = keyboardBacklightStatesNew;
        this.tccd.dbusData.keyboardBacklightStatesJSON = JSON.stringify(this.keyboardBacklightStates);
    }

    private async updateSysFsFromSettings(): Promise<void> {
        let brightness: Number = this.tccd.settings.keyboardBacklightBrightness;
        if (brightness === undefined) {
            brightness = Math.floor(this.keyboardBacklightCapabilities.maxBrightness * 0.5);
        }

        if (await fileOKAsync(this.clevoLedsWhiteOnly + "/brightness")) {
            await fs.promises.appendFile(this.clevoLedsWhiteOnly + "/brightness", brightness.toString());
        }

        for (let i: number = 0; i < this.clevoLedsRGBZones.length ; ++i) {
            if (await fileOKAsync(this.clevoLedsRGBZones[i] + "/brightness")) {
                await fs.promises.appendFile(this.clevoLedsRGBZones[i] + "/brightness", brightness.toString());
            }
        }

        if (this.tccd.settings.keyboardBacklightColor !== undefined) {
            if (this.tccd.settings.keyboardBacklightColor.length == this.keyboardBacklightCapabilities.zones) {
                for (let i: number = 0; i < this.clevoLedsRGBZones.length ; ++i) {
                    if (await fileOKAsync(this.clevoLedsRGBZones[i] + "/multi_intensity")) {
                        await fs.promises.appendFile(this.clevoLedsRGBZones[i] + "/multi_intensity", this.rgbaIntToRGBDecString(this.tccd.settings.keyboardBacklightColor[i]));
                    }
                }
            }
        }
        else {
            for (let i: number = 0; i < this.clevoLedsRGBZones.length ; ++i) {
                if (await fileOKAsync(this.clevoLedsRGBZones[i] + "/multi_intensity")) {
                    await fs.promises.appendFile(this.clevoLedsRGBZones[i] + "/multi_intensity", "255 255 255");
                }
            }
        }
    }

    private async updateKeyboardBacklightStatesFromSysFS(): Promise<void> {
        let keyboardBacklightStatesNew = [];

        if (await fileOKAsync(this.clevoLedsWhiteOnly + "/brightness")) {
            keyboardBacklightStatesNew.push({} as KeyboardBacklightStateInterface);
            keyboardBacklightStatesNew[0].mode = KeyboardBacklightColorModes.static;
            keyboardBacklightStatesNew[0].brightness = Number(await fs.promises.readFile(this.clevoLedsWhiteOnly + "/brightness"));
        }
        else {
            for (let i: number = 0; i < this.clevoLedsRGBZones.length ; ++i) {
                if (await fileOKAsync(this.clevoLedsRGBZones[i] + "/brightness")) {
                    keyboardBacklightStatesNew.push({} as KeyboardBacklightStateInterface);

                    keyboardBacklightStatesNew[i].mode = KeyboardBacklightColorModes.static;

                    keyboardBacklightStatesNew[i].brightness = Number(await fs.promises.readFile(this.clevoLedsRGBZones[i] + "/brightness"));

                    if (await fileOKAsync(this.clevoLedsRGBZones[i] + "/multi_intensity")) {
                        let colors = (await fs.promises.readFile(this.clevoLedsRGBZones[i] + "/multi_intensity")).toString().split(' ').map(Number);
                        keyboardBacklightStatesNew[i].red = colors[0];
                        keyboardBacklightStatesNew[i].green = colors[1];
                        keyboardBacklightStatesNew[i].blue = colors[2];
                    }
                }
            }
        }
        this.updateKeyboardBacklightStatesFromValue(keyboardBacklightStatesNew);
    }

    private async updateSettingsFromKeyboardBacklightStates(): Promise<void> {
        await this.updateSettingsFromValue(this.keyboardBacklightStates);
    }

    private async keyboardBacklightStatesNewJSONSubscriptionHandler(keyboardBacklightStatesNewJSON: string): Promise<void> {
        if (keyboardBacklightStatesNewJSON !== undefined ) {
            this.keyboardBacklightStatesPendingNewJSON = keyboardBacklightStatesNewJSON;

            this.keyboardBacklightStatesUpdating = true;
            clearTimeout(this.keyboardBacklightStatesUpdatingReset);

            if (this.keyboardBacklightStatesWritingNew === false) {
                this.keyboardBacklightStatesWritingNew = true;
                while(this.keyboardBacklightStatesPendingNewJSON !== undefined) {
                    let keyboardBacklightStatesNew = JSON.parse(this.keyboardBacklightStatesPendingNewJSON);
                    this.keyboardBacklightStatesPendingNewJSON = undefined;
                    await this.updateSettingsFromValue(keyboardBacklightStatesNew);
                    await this.updateSysFsFromSettings();
                }
                this.keyboardBacklightStatesWritingNew = false;

                this.keyboardBacklightStatesUpdatingReset = setTimeout(() => {
                    this.keyboardBacklightStatesUpdating = false;
                    this.onWork();
                }, 500); // There is a small delay between writing SysFS and getting the correct value back.
            }
        }
    }

    public onStart(): void {
        this.getKeyboardBacklightCapabilities();

        this.updateSysFsFromSettings().then(() => {
            setTimeout(this.onWork, 500); // There is a small delay between writing SysFS and getting the correct value back.
        });

        this.tccd.dbusData.keyboardBacklightStatesNewJSON.subscribe(this.keyboardBacklightStatesNewJSONSubscriptionHandler.bind(this));
    }

    public onWork(): void {
        if (this.keyboardBacklightStatesUpdating === false) {
            this.updateKeyboardBacklightStatesFromSysFS().then(() => {
                this.updateSettingsFromKeyboardBacklightStates();
            });
        }
    }

    public onExit(): void {
        this.onWork();
    }
}
