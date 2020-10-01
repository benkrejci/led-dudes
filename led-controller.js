exports.getLedController = (config) => {
    if (config.ledType === 'dotstar') return new DotstarController(config)
    if (config.ledType === 'ws281x')  return new Ws281xController(config)
    throw new Error(`No implementation for ledType ${config.ledType}`)
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
const dotstar = require('dotstar')
const SPI = require('pi-spi')
const SPI_DEVICE_DEFAULT = '/dev/spidev0.0'

class DotstarController extends AbstractLedController {
    constructor(config) {
        super(config)

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
const ws281x = require('rpi-ws281x-native')

const rgbToInt = (r, g, b) => ((r & 0xff) << 16) + ((g & 0xff) << 8) + (b & 0xff)
const GAMMA_DEFAULT = 2.2
// This function improves the color accuracy somewhat by doing gamma correction
// In my experience, dotstars do not need this--maybe they have gamma correction built in?
const normalize = (value, gamma) => Math.pow(value / 255, 1 / gamma) * 255

class Ws281xController extends AbstractLedController {
    constructor(config) {
        super(config)

        if (isNaN(config.stripLength)) throw new TypeError('stripLength is required')
        if (config.gamma === undefined) config.gamma = GAMMA_DEFAULT
        this.rgbToInt = this.config.colorOrder === 'grb' ? (r, g, b) => rgbToInt(g, r, b) : rgbToInt

        this.pixelData = new Uint32Array(config.stripLength)
        ws281x.init(config.stripLength)
        ws281x.setBrightness(255)
    }

    setPixel(index, red, green, blue) {
        if (index < 0 || index > this.config.stripLength) throw new Error(`setPixel index ouside of range 0 - ${this.config.stripLength}`)

	const gamma = this.config.gamma
        this.pixelData[index] = this.rgbToInt(normalize(red, gamma), normalize(green, gamma), normalize(blue, gamma))
    }

    update() {
        ws281x.render(this.pixelData)
    }

    off() {
        ws281x.reset()
    }
}
