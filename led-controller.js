exports.getLedController = (config) => {
    const ledType = String(config.ledType).toLowerCase()
    if (['dotstar', 'sk9822'].includes(ledType)) return new DotstarController(config)
    if (['neopixel', 'ws281x'].includes(ledType))  return new Ws281xController(config)
    throw new Error(`Invalid or unsupported ledType: ${config.ledType}`)
}

class AbstractLedController {
    constructor(config) {
        this.config = config
    }

    setPixel(index, red, blue, green) {
        throw new Error('Not implemented')
    }

    update() {
        throw new Error('Not implemented')
    }

    off() {
        throw new Error('Not implemented')
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
        ws281x.init(config.stripLength)
        ws281x.setBrightness(255)
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

