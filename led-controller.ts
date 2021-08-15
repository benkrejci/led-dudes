export interface Config {
  ledType: 'dummy' | 'dotstar' | 'sk9822' | 'neopixel' | 'ws281x'
  stripLength: number
  spiDevice?: string
  colorOrder?: 'rgb' | 'grb'
}

export const getLedController = (
  config: Config,
  dummy = false
): AbstractLedController => {
  const ledType = String(config.ledType).toLowerCase()
  if (dummy || 'dummy' === ledType) return new DummyController(config)
  if (['dotstar', 'sk9822'].includes(ledType))
    return new DotstarController(config)
  if (['neopixel', 'ws281x'].includes(ledType))
    return new Ws281xController(config)
  throw new Error(`Invalid or unsupported ledType: ${config.ledType}`)
}

export abstract class AbstractLedController {
  protected config: Config

  constructor(config: Config) {
    this.config = config
  }

  abstract setPixel(index: number, red: number, green: number, blue: number): void
  abstract update(): void
  abstract off(): void

  log(...args: any[]): void {
    console.log(...args)
  }
}

/**
 * Dummy controller; shows simulation of LEDs in terminal
 */
const PIXEL_CHAR = '●'

class DummyController extends AbstractLedController {
  private readonly pixelData: number[][]
  private term?: import('terminal-kit').Terminal
  private logLine: string

  constructor(config: Config) {
    super(config)

    this.pixelData = new Array(config.stripLength)
    this.logLine = ''

    this.initTerm()
  }

  private async initTerm() {
    // only import terminal kit if we have to
    // this works because the import in term declaration above is actually just a type import
    this.term = (await import('terminal-kit')).terminal
    this.term.clear().hideCursor(true).saveCursor()
  }

  setPixel(index: number, red: number, green: number, blue: number) {
    if (index < 0 || index > this.config.stripLength)
      throw new Error(
        `setPixel index ouside of range 0 - ${this.config.stripLength}`
      )

    this.pixelData[index] = [red, green, blue]
  }

  update() {
    if (!this.term) throw new Error(`update() called before term initialized`)
    const width = this.term.width
    const pixelStack = this.pixelData.reverse()
    let x = 0,
      y = 0
    let direction = 'right'
    let lastHorizontalY = 0
    let currentPixel
    this.term.restoreCursor().move(0, 1)
    while ((currentPixel = pixelStack.pop())) {
      // @ts-ignore -- @types/terminal-kit is broken
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
    // @ts-ignore
    this.term.nextLine(1, this.logLine).eraseLineAfter().eraseDisplayBelow()
  }

  off() {
    if (!this.term) throw new Error(`off() called before term initialized`)
    this.term.clear().hideCursor(false)
  }
}

/**
 * AdaFruit Dotstar implementation
 */
class DotstarController extends AbstractLedController {
  private strip?: import('dotstar').Dotstar

  constructor(config: Config) {
    super(config)

    this.init()
  }

  private async init() {
    // see comment above near require('terminal-kit')
    const dotstar = await import('dotstar')
    const SPI = require('pi-spi')
    const SPI_DEVICE_DEFAULT = '/dev/spidev0.0'

    const spi = SPI.initialize(this.config.spiDevice || SPI_DEVICE_DEFAULT)
    // plus one seems to resolve the last pixel still being lit after calling `off()`
    this.strip = new dotstar.Dotstar(spi, { length: this.config.stripLength + 1 })
  }

  setPixel(...args: [number, number, number, number]) {
    this.strip?.set(...args)
  }

  update() {
    this.strip?.sync()
  }

  off() {
    //this.strip?.off()
    // off() seems to have a bug which always leaves the last pixel in the strip on, this works better
    for (let i = 0; i < this.config.stripLength; i++) {
      this.setPixel(i, 0, 0, 0)
    }
  }
}

/**
 * WS281x LED implementation (used in AdaFruit NeoPixels)
 */
const rgbToInt = (r: number, g: number, b: number): number =>
  ((r & 0xff) << 16) + ((g & 0xff) << 8) + (b & 0xff)
// This function improves the color accuracy somewhat by doing gamma correction
// I also boost the output by 16 because my NeoPixels don't turn on from 0 - 15
// In my experience, dotstars do not need this
//const normalize = (value) => Math.pow(value / 255, 1 / 2.2) * 200 // regular gamma correct
const normalize = (value: number): number =>
  (Math.asin(value / 127.5 - 1) / Math.PI + 0.5) * 239 + 16 // arcsin normalize that seems to fit better

class Ws281xController extends AbstractLedController {
  private readonly ws281x: {
    init: (stripLength: number) => void
    setBrightness: (brightness: number) => void
    render: (pixelData: Uint32Array) => void
    reset: () => void
  }
  private readonly rgbToInt: (r: number, g: number, b: number) => number
  private readonly pixelData: Uint32Array

  constructor(config: Config) {
    super(config)

    this.ws281x = require('rpi-ws281x-native')

    if (isNaN(config.stripLength))
      throw new TypeError('stripLength is required')
    this.rgbToInt =
      this.config.colorOrder === 'grb'
        ? (r, g, b) => rgbToInt(g, r, b)
        : rgbToInt

    this.pixelData = new Uint32Array(config.stripLength)
    this.ws281x.init(config.stripLength)
    this.ws281x.setBrightness(255)
  }

  setPixel(index: number, red: number, green: number, blue: number) {
    if (index < 0 || index > this.config.stripLength)
      throw new Error(
        `setPixel index ouside of range 0 - ${this.config.stripLength}`
      )

    this.pixelData[index] = this.rgbToInt(
      normalize(red),
      normalize(green),
      normalize(blue)
    )
  }

  update() {
    this.ws281x.render(this.pixelData)
  }

  off() {
    this.ws281x.reset()
  }
}
