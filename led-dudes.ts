import _ from 'lodash'
import {
  AbstractLedController,
  getLedController,
  Config as ControllerConfig,
} from './led-controller'

export type DudeMode = 'constant' | 'stripes' | 'test' | 'classic' | 'fm'
export type BlendMode =
  | 'SUM'
  | 'AVERAGE'
  | 'MULTIPLY'
  | 'DODGE'
  | 'BURN'
  | 'REPLACE'
  | 'DEFAULT'

export interface Config extends ControllerConfig {
  dudes: DudeConfig[]
  schedule: ScheduleRule[]
  intervalDelay: number
}

export interface Opts {
  dummyMode: boolean
  ignoreSchedule: boolean
}

export interface ScheduleRule {
  start: ScheduleTime
  end: ScheduleTime
}

export type ScheduleTime = [number, number]

const MODE_DEFAULT: DudeMode = 'fm'
const POWER_DEFAULT = 2
const SPEED_DEFAULT = 1
const MORPH_RATE_DEFAULT = 10
const ACCELERATION_DEFAULT = 1
const WIDTH_DEFAULT = 2.5
const STROBE_PERIOD_DEFAULT = 1000 / 60
const BLEND_MODE_DEFAULT: BlendMode = 'SUM'
const DUDES_INTERVAL_DELAY = 0
const SCHEDULE_INTERVAL_DELAY = 10 * 1000

const SEED_SCALE = 1000
const CLASSIC_TIME_SCALE = 1 / 7000
const CLASSIC_POSITION_SCALE = 1
const FM_TIME_SCALE = 1 / 1000 / 100
const FM_POSITION_SCALE = 1 / 12
const STRIPES_TIME_SCALE = 1 / 500
const ANTI_ALIAS_WIDTH = 1

export const start = (config: Config, opts: Opts): DudeManager =>
  new DudeManager(config, opts)

export class DudeManager {
  private readonly config: Config
  private readonly controller: AbstractLedController
  private readonly dudes: Dude[]

  private dudesInterval?: NodeJS.Timeout
  private scheduleInterval?: NodeJS.Timeout
  private currentScheduleRule?: ScheduleRule
  private paused = false

  constructor(config: Config, { dummyMode, ignoreSchedule }: Opts) {
    this.config = config

    this.controller = getLedController(config as ControllerConfig, dummyMode)

    if (!config.dudes || !config.dudes.length)
      throw new TypeError('Missing or invalid dudes array')

    let lastDude: Dude
    this.dudes = config.dudes.map((dudeConfig) => {
      const seed = lastDude && dudeConfig.linked ? lastDude.seed : undefined
      lastDude = new Dude({
        seed,
        ...dudeConfig,
        stripLength: config.stripLength,
      })
      return lastDude
    })

    if (ignoreSchedule || !config.schedule) {
      console.log(`Starting LED dudes...`)
      this.dudesInterval = this.start()
    } else {
      this.checkSchedule()
      this.scheduleInterval = setInterval(
        this.checkSchedule.bind(this),
        SCHEDULE_INTERVAL_DELAY
      )
    }

    ;['SIGTERM', 'SIGINT'].forEach((event) =>
      process.on(event, () => {
        console.log(`Caught ${event}, exiting`)
        if (this.dudesInterval !== undefined) clearInterval(this.dudesInterval)
        if (this.scheduleInterval !== undefined)
          clearInterval(this.scheduleInterval)
        this.controller.off()
        process.exit(1)
      })
    )
  }

  public pause() {
    if (!this.paused) {
      console.log('Pause operation')
      this.paused = true
      if (this.dudesInterval) {
        clearInterval(this.dudesInterval)
        this.dudesInterval = undefined
      }
      if (this.currentScheduleRule) this.currentScheduleRule = undefined
      this.controller.off()
    }
  }

  public resume() {
    if (this.paused) {
      console.log('Resume operation')
      this.paused = false
      this.controller.off()
      this.checkSchedule()
    }
  }

  public setPixels(getRgb: (position: number) => Rgb) {
    for (let position = 0; position < this.config.stripLength; position++) {
      this.controller.setPixel(position, ...getRgb(position))
    }
    this.controller.update()
  }

  public setAllPixels(rgb: Rgb) {
    this.setPixels((_position) => rgb)
  }

  private checkSchedule(): void {
    console.log(`Checking schedule...`)
    const now = new Date()
    if (this.currentScheduleRule === undefined) {
      if (
        this.config.schedule.every((rule) => {
          if (isAfter(now, rule.start) && !isAfter(now, rule.end)) {
            console.log(
              `It is now after schedule start ${String(rule.start[0]).padEnd(
                2,
                '0'
              )}:${String(rule.start[1]).padEnd(2, '0')}, starting dudes`
            )
            this.dudesInterval = this.start()
            this.currentScheduleRule = rule
          } else {
            return true
          }
        })
      ) {
        console.log(
          `No matching time slots; waiting ${SCHEDULE_INTERVAL_DELAY / 1000}s`
        )
      }
    } else if (
      this.dudesInterval !== undefined &&
      isAfter(now, this.currentScheduleRule.end)
    ) {
      console.log(
        `It is now after schedule end ${String(
          this.currentScheduleRule.end[0]
        ).padEnd(2, '0')}:${String(this.currentScheduleRule.end[1]).padEnd(
          2,
          '0'
        )}, starting dudes`
      )
      clearInterval(this.dudesInterval)
      this.controller.off()
      this.dudesInterval = undefined
      this.currentScheduleRule = undefined
    }
  }

  private start(): NodeJS.Timeout {
    let frames = 0
    let sinceFpsPrint = 0
    let tLast = +new Date()

    return setInterval(() => {
      const t = +new Date()
      const dt = t - tLast
      tLast = t
      this.dudes.forEach((dude) => dude.timeTick(t, dt))

      for (let position = 0; position < this.config.stripLength; position++) {
        const color = <Rgb>this.dudes
          .map((dude): [Dude, Rgb] => [
            dude,
            dude.positionTick(t, dt, position),
          ])
          .reduce(
            (rgbSum: Rgb, [dude, rgb]) =>
              blendColors(dude.blendMode, rgbSum, rgb),
            [0, 0, 0]
          )
          .map((value) => Math.max(0, Math.min(255, value)))
        this.controller.setPixel(position, ...color)
      }
      frames++
      sinceFpsPrint += dt
      if (sinceFpsPrint > 1000) {
        const fps = ((frames / sinceFpsPrint) * 1000).toPrecision(3)
        this.controller.log(`fps: ${fps}`)
        frames = 0
        sinceFpsPrint = 0
      }
      this.controller.update()
    }, this.config.intervalDelay || DUDES_INTERVAL_DELAY)
  }
}

interface DudeConfig {
  stripLength: number
  rgb: Rgb
  mode?: DudeMode
  linked?: boolean
  seed?: number
  power?: number
  speed?: number
  morphRate?: number
  acceleration?: number
  width?: number
  blendMode?: BlendMode
  strobe?: boolean
  strobePeriod?: number
  scale?: number
  offset?: number
  slide?: number
}

export type Rgb = [number, number, number]

class Dude {
  readonly blendMode: BlendMode

  private readonly stripLength: number
  private readonly rgb: Rgb
  private readonly mode: DudeMode
  private readonly power: number
  private readonly speed: number
  private readonly morphRate: number
  private readonly acceleration: number
  private readonly width: number

  private C?: number
  private M?: number
  private D?: number
  seed?: number
  private timeParam?: number
  private strobe?: boolean
  private strobePeriod?: number
  private sinceFlip?: number
  private scale?: number
  private offset?: number
  private slide: number
  private firstEdge?: number

  private testColors?: Rgb[]
  private positionParam?: number
  private positionDelta?: number
  private on: boolean = true

  constructor(config: DudeConfig) {
    this.stripLength = config.stripLength

    this.rgb = config.rgb
    this.mode = _.defaultTo(config.mode, MODE_DEFAULT)
    this.power = _.defaultTo(config.power, POWER_DEFAULT)
    this.speed = _.defaultTo(config.speed, SPEED_DEFAULT)
    this.morphRate = _.defaultTo(config.morphRate, MORPH_RATE_DEFAULT)
    this.acceleration = _.defaultTo(config.acceleration, ACCELERATION_DEFAULT)
    this.width = _.defaultTo(config.width, WIDTH_DEFAULT)
    this.blendMode = _.defaultTo(config.blendMode, BLEND_MODE_DEFAULT)
    this.scale = config.scale
    this.offset = config.offset
    this.slide = config.slide || 0

    if (this.mode !== 'constant' && this.mode !== 'stripes') {
      if (this.mode === 'classic') {
      } else if (this.mode === 'fm') {
        this.C = 0.59
        this.M = 3.7
      }

      this.seed = _.defaultTo(
        config.seed,
        Math.random() * SEED_SCALE - 0.5 * SEED_SCALE
      )
      this.timeParam = 0

      this.strobe = !!config.strobe
      if (this.strobe) {
        this.strobePeriod = _.defaultTo(
          config.strobePeriod,
          STROBE_PERIOD_DEFAULT
        )
        this.sinceFlip = 0
      }
    }
  }

  timeTick(t: number, dt: number): void {
    if (this.mode === 'constant') return
    if (this.mode === 'stripes') {
      this.firstEdge = t * STRIPES_TIME_SCALE * this.speed + (this.offset || 0)
    } else if (this.mode === 'test') {
      this.testColors = []
      for (let i = 0; i < this.stripLength; i++) {
        let color = (i + 1) / this.stripLength
        color = i % 2 ? 1 - color : color
        color *= 255
        this.testColors[i] = [color, color, color]
      }
    } else if (this.mode === 'classic') {
      if (
        this.timeParam === undefined ||
        this.morphRate === undefined ||
        this.seed === undefined
      )
        throw TypeError('this should never happen')
      const speed = Math.sin(
        this.acceleration * CLASSIC_TIME_SCALE * t + this.seed
      )
      this.timeParam += this.morphRate * speed * CLASSIC_TIME_SCALE * dt
      this.positionParam = CLASSIC_TIME_SCALE * t * this.speed + 2 * this.seed
      this.positionDelta = (speed * CLASSIC_POSITION_SCALE) / this.width
    } else if (this.mode === 'fm') {
      if (
        this.seed === undefined ||
        this.C === undefined ||
        this.M === undefined
      )
        throw TypeError('this should never happen')
      this.timeParam =
        this.speed *
        (fm(
          FM_TIME_SCALE * this.morphRate * t + 7 * this.seed,
          this.C,
          1,
          this.M
        ) +
          FM_TIME_SCALE * t)
      this.D = scaleSine(
        Math.sin(FM_TIME_SCALE * 2 * this.morphRate * t + 3 * this.seed),
        0.6,
        3
      )
    }
    if (this.strobe) {
      if (this.sinceFlip === undefined || this.strobePeriod === undefined)
        throw TypeError('this should never happen')
      this.sinceFlip += dt
      if (this.sinceFlip >= this.strobePeriod) {
        this.sinceFlip = 0
        this.on = !this.on
      }
    }
  }

  positionTick(t: number, dt: number, position: number): Rgb {
    if (this.strobe && !this.on) return [0, 0, 0]
    if (this.mode === 'test') {
      if (!this.testColors || !this.testColors[position])
        throw new TypeError('this should never happen')
      return this.testColors[position]
    }
    if (this.mode === 'constant') return this.rgb
    if (this.mode === 'stripes') {
      if (this.firstEdge === undefined)
        throw TypeError('this should never happen')
      const toFirstEdge = position - this.firstEdge
      const inStripe = Math.floor(toFirstEdge / this.width) % 2
      const toLeftEdge = toFirstEdge % this.width
      const toRightEdge = this.width - toLeftEdge
      let scale = 1
      if (toLeftEdge < ANTI_ALIAS_WIDTH / 2) {
        scale = toLeftEdge / (ANTI_ALIAS_WIDTH / 2)
      } else if (toRightEdge < ANTI_ALIAS_WIDTH / 2) {
        scale = toLeftEdge / (ANTI_ALIAS_WIDTH / 2)
      }
      if (!inStripe) scale = 1 - scale
      return <Rgb>this.rgb.map((value) => value * scale)
    }
    let level = 1
    if (this.mode === 'classic') {
      if (
        this.positionParam === undefined ||
        this.positionDelta === undefined ||
        this.timeParam === undefined ||
        this.scale === undefined ||
        this.offset === undefined
      )
        throw TypeError('this should never happen')
      this.positionParam += this.positionDelta
      level =
        scaleSine(0.2 * this.timeParam + this.positionParam) *
        scaleSine(this.timeParam + 0.2 * this.positionParam)
      level = Math.pow(level, this.power)
      if (this.scale || this.offset) {
        level = level * this.scale + this.offset
        level = Math.max(0, Math.min(1, level))
      }
    } else if (this.mode === 'fm') {
      if (
        this.timeParam === undefined ||
        this.seed === undefined ||
        this.C === undefined ||
        this.D === undefined ||
        this.M === undefined
      )
        throw TypeError('this should never happen')
      level = Math.pow(
        scaleSine(
          fm(
            this.timeParam +
              (FM_POSITION_SCALE / this.width) * position +
              this.seed +
              this.slide,
            this.C,
            this.D,
            this.M
          )
        ),
        this.power
      )
    }
    return <Rgb>this.rgb.map((value) => value * level)
  }
}

const blendColors = (blendMode: BlendMode, base: Rgb, blend: Rgb): Rgb => {
  if (blendMode === 'DEFAULT') {
    const difference =
      (blend.reduce((a, p) => a + p) - base.reduce((a, p) => a + p)) / 255
    if (difference <= 0) return base
    else
      return <Rgb>base.map((value, index) => value + difference * blend[index])
  } else {
    return <Rgb>base.map((sumValue, index) => {
      const value = blend[index]
      if (blendMode === 'AVERAGE') return (sumValue + value) / 2
      else if (blendMode === 'SUM') return sumValue + value
      else if (blendMode === 'MULTIPLY') return sumValue * value
      else if (blendMode === 'DODGE') return sumValue / (1 - value / 255)
      else if (blendMode === 'BURN') return (1 - value / 255) / sumValue
      else if (blendMode === 'REPLACE') return value > 0 ? value : sumValue
    })
  }
}

const isAfter = (date: Date, ruleTime: ScheduleTime): boolean =>
  date.getHours() == ruleTime[0]
    ? date.getMinutes() >= ruleTime[1]
    : date.getHours() > ruleTime[0]

const scaleSine = (x: number, min = 0, max = 1): number =>
  (Math.sin(x) * 0.5 + 0.5) * (max - min) + min

/**
 * f(t) = Asin(2piCt + Dsin(2piMt)) where:
 * A - amplitude
 * C - carrier freq
 * D - "depth of modulation" (deviation from carrier)
 * M - modulation freq
 * t - time
 *
 * The following are precomputed to avoid redundant calculation:
 * const1 - 2piC
 * const2 - 2piM
 * tVar1 - const1*t
 * tVar2 - const2*t
 */
const fm = (x: number, C: number, D: number, M: number): number =>
  Math.sin(C * x + D * Math.sin(M * x))
