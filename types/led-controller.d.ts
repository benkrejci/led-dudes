export function getLedController(config: Config, dummy?: boolean): AbstractLedController;
export type Config = {
    ledType: 'dummy' | 'dotstar' | 'sk9822' | 'neopixel' | 'ws281x';
    stripLength: number;
    spiDevice?: string;
};
declare class AbstractLedController {
    /** @private */
    private constructor();
    /** @private **/
    private config;
    /**
     * @param {number} index
     * @param {number} red
     * @param {number} blue
     * @param {number} green
     */
    setPixel(index: number, red: number, blue: number, green: number): void;
    update(): void;
    off(): void;
    log(...args: any[]): void;
}
export {};
