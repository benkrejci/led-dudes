/**
 * @typedef {Object} Config
 * @property {'dummy' | 'dotstar' | 'sk9822' | 'neopixel' | 'ws281x'} ledType
 * @property {number} stripLength
 * @property {string} [spiDevice]
 */

/**
 * @param {Config} config
 * @param {boolean} dummy
 * @returns {AbstractLedController}
 */
exports.getLedController = (config, dummy = false) => {
    const ledType = String(config.ledType).toLowerCase()
    if (dummy || 'dummy' === ledType) return new DummyController(config)
    if (['dotstar', 'sk9822'].includes(ledType)) return new DotstarController(config)
    if (['neopixel', 'ws281x'].includes(ledType))  return new Ws281xController(config)
    throw new Error(`Invalid or unsupported ledType: ${config.ledType}`)
}

class AbstractLedController {
    /** @private */
    constructor(config) {
        /** @private **/
        this.config = config
    }

    /**
     * @param {number} index
     * @param {number} red
     * @param {number} blue
     * @param {number} green
     */
    setPixel(index, red, blue, green) {
        throw new Error('Not implemented')
    }

    update() {
        throw new Error('Not implemented')
    }

    off() {
        throw new Error('Not implemented')
    }

    log(...args) {
        console.log(...args)
    }
}

/**
 * Dummy controller; shows simulation of LEDs in terminal
 */
const PIXEL_CHAR = '●'

class DummyController extends AbstractLedController {
    constructor(config) {
        super(config)

        if (isNaN(config.stripLength)) throw new TypeError('stripLength is required')

        this.term = require('terminal-kit').terminal
        this.term.clear().hideCursor(true).saveCursor()

        this.pixelData = new Array(config.stripLength)
        this.logLine = ''
    }

    log(...args) {
        this.logLine = args.join(', ')
    }

    setPixel(index, red, green, blue) {
        if (index < 0 || index > this.config.stripLength) throw new Error(`setPixel index ouside of range 0 - ${this.config.stripLength}`)

        this.pixelData[index] = [red, green, blue]
    }

    update() {
        const width = this.term.width
        const pixelStack = this.pixelData.reverse()
        let x = 0, y = 0
        let direction = 'right'
        let lastHorizontalY = 0
        let currentPixel
        this.term.restoreCursor().move(0, 1)
        while (currentPixel = pixelStack.pop()) {
            this.term.colorRgb(...currentPixel, PIXEL_CHAR + ' ').move(-2, 0)
            if (direction === 'right') {
                if (x < width - 2) {
                    this.term.move(2, 0)
                    x += 2
                } else {
                    direction = 'down'
                    lastHorizontalY = y
                    this.term.move(0, 1).eraseLine()
                    y++
                }
            } else if (direction === 'down') {
                if (y - lastHorizontalY < 2) {
                    this.term.move(0, 1).eraseLine()
                    y++
                } else if (x === 0) {
                    direction = 'right'
                    this.term.move(2, 0)
                    x += 2
                } else {
                    direction = 'left'
                    this.term.move(-2, 0)
                    x -= 2
                }
            } else if (direction === 'left') {
                if (x > 0) {
                    this.term.move(-2, 0)
                    x -= 2
                } else {
                    direction = 'down'
                    lastHorizontalY = y
                    this.term.move(0, 1).eraseLine()
                    y++
                }
            }
        }
        this.term.nextLine(1, this.logLine).eraseLineAfter().eraseDisplayBelow()
    }

    off() {
        this.term.clear().hideCursor(false)
    }
}

/**
 * AdaFruit Dotstar implementation
 */
class DotstarController extends AbstractLedController {
    constructor(config) {
        super(config)

        const dotstar = require('dotstar')
        const SPI = require('pi-spi')
        const SPI_DEVICE_DEFAULT = '/dev/spidev0.0'

        if (isNaN(config.stripLength)) throw new TypeError('stripLength is required')

        const spi = SPI.initialize(config.spiDevice || SPI_DEVICE_DEFAULT)
        this.strip = new dotstar.Dotstar(spi, { length: config.stripLength })
    }

    setPixel(...args) {
        this.strip.set(...args)
    }

    update() {
        this.strip.sync()
    }

    off() {
        this.strip.off()
    }
}


/**
 * WS281x LED implementation (used in AdaFruit NeoPixels)
 */
const rgbToInt = (r, g, b) => ((r & 0xff) << 16) + ((g & 0xff) << 8) + (b & 0xff)
// This function improves the color accuracy somewhat by doing gamma correction
// I also boost the output by 16 because my NeoPixels don't turn on from 0 - 15
// In my experience, dotstars do not need this
//const normalize = (value) => Math.pow(value / 255, 1 / 2.2) * 200 // regular gamma correct
const normalize = (value) => ( Math.asin(value / 127.5 - 1) / Math.PI + 0.5 ) * 239 + 16 // arcsin normalize that seems to fit better

class Ws281xController extends AbstractLedController {
    constructor(config) {
        super(config)

        this.ws281x = require('rpi-ws281x-native')

        if (isNaN(config.stripLength)) throw new TypeError('stripLength is required')
        this.rgbToInt = this.config.colorOrder === 'grb' ? (r, g, b) => rgbToInt(g, r, b) : rgbToInt

        this.pixelData = new Uint32Array(config.stripLength)
        this.ws281x.init(config.stripLength)
        this.ws281x.setBrightness(255)
    }

    setPixel(index, red, green, blue) {
        if (index < 0 || index > this.config.stripLength) throw new Error(`setPixel index ouside of range 0 - ${this.config.stripLength}`)

        this.pixelData[index] = this.rgbToInt(normalize(red), normalize(green), normalize(blue))
    }

    update() {
        this.ws281x.render(this.pixelData)
    }

    off() {
        this.ws281x.reset()
    }
}

