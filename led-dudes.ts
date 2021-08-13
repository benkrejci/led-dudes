import _ from 'lodash'
import {
  AbstractLedController,
  Config,
  getLedController,
} from './led-controller'

const MODE_DEFAULT = 'fm'
const POWER_DEFAULT = 2
const SPEED_DEFAULT = 1
const MORPH_RATE_DEFAULT = 10
const ACCELERATION_DEFAULT = 1
const WIDTH_DEFAULT = 2.5
const STROBE_PERIOD_DEFAULT = 1000 / 60
const BLEND_MODE_DEFAULT = 'SUM'
const DUDES_INTERVAL_DELAY = 0
const SCHEDULE_INTERVAL_DELAY = 10 * 1000

const SEED_SCALE = 1000
const CLASSIC_TIME_SCALE = 1 / 7000
const CLASSIC_POSITION_SCALE = 1
const FM_TIME_SCALE = 1 / 1000 / 100
const FM_POSITION_SCALE = 1 / 12

export type Rgb = [number, number, number]
export type DudeMode = 'fm' | 'constant' | 'test' | 'classic'
export type BlendMode =
  | 'SUM'
  | 'AVERAGE'
  | 'DEFAULT'
  | 'DODGE'
  | 'BURN'
  | 'MULTIPLY'
  | 'REPLACE'

export type Opts = { dummyMode: boolean; ignoreSchedule: boolean }
export type DudeConfig = {
  stripLength: number
  rgb: Rgb
  mode: DudeMode
  power: number
  speed: number
  morphRate: number
  acceleration: number
  width: number
  blendMode: BlendMode
  strobe: boolean
  strobePeriod: number
}
export type TimeTuple = [number, number]
export type ScheduleRule = {
  start: TimeTuple
  end: TimeTuple
}
export type ManagerConfig = Config & {
  dudes: DudeConfig[]
  schedule: ScheduleRule[]
  intervalDelay: number
}

export const start = (config: ManagerConfig, opts: Opts): DudeManager =>
  new DudeManager(config, opts)

export class DudeManager {
  private config: ManagerConfig
  private controller: AbstractLedController
  private dudes: Dude[]
  private dudesInterval: NodeJS.Timeout | null
  private scheduleInterval: NodeJS.Timeout | null
  private currentScheduleRule: any
  private paused = false

  constructor(config: ManagerConfig, { dummyMode, ignoreSchedule }: Opts) {
    this.config = config

    this.controller = getLedController(config, dummyMode)

    if (!config.dudes || !config.dudes.length)
      throw new TypeError('Missing or invalid dudes array')

    this.dudes = config.dudes.map(
      (dudeConfig) =>
        new Dude({ ...dudeConfig, stripLength: config.stripLength })
    )

    this.dudesInterval = null
    this.scheduleInterval = null
    this.currentScheduleRule = null
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
        if (this.dudesInterval !== null) clearInterval(this.dudesInterval)
        if (this.scheduleInterval !== null) clearInterval(this.scheduleInterval)
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
        this.dudesInterval = null
      }
      if (this.currentScheduleRule) this.currentScheduleRule = null
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
  }

  public setAllPixels(rgb: Rgb) {
    this.setPixels((_position) => rgb)
    this.controller.update()
  }

  private checkSchedule() {
    if (this.paused) return
    console.log(`Checking schedule...`)
    const now = new Date()
    if (this.currentScheduleRule === null) {
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
      this.dudesInterval !== null &&
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
      this.dudesInterval = null
      this.currentScheduleRule = null
    }
  }

  private start() {
    let frames = 0
    let sinceFpsPrint = 0
    let tLast = +new Date()

    return setInterval(() => {
      const t = +new Date()
      const dt = t - tLast
      tLast = t
      this.dudes.forEach((dude) => dude.timeTick(t, dt))

      this.setPixels(
        (position) =>
          this.dudes
            .map<[Dude, Rgb]>((dude) => [
              dude,
              dude.positionTick(t, dt, position),
            ])
            .reduce(
              (rgbSum, [dude, rgb]) => blendColors(dude.blendMode, rgbSum, rgb),
              [0, 0, 0] as Rgb
            )
            .map((value) => Math.max(0, Math.min(255, value))) as Rgb
      )
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

class Dude {
  public blendMode: BlendMode

  private stripLength: number
  private rgb: Rgb
  private mode: DudeMode
  private power: number
  private speed: number
  private morphRate: number
  private acceleration: number
  private width: number

  private C = 0
  private M = 0
  private D = 0
  private on = false
  private seed = 0
  private timeParam = 0
  private strobe = false
  private strobePeriod = 0
  private sinceFlip = 0
  private testColors: Rgb[] = []
  private positionParam = 0
  private positionDelta = 0
  private scale = 0
  private offset = 0

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

    if (this.mode !== 'constant') {
      if (this.mode === 'classic') {
      } else if (this.mode === 'fm') {
        this.C = 0.59
        this.M = 3.7
      }

      this.seed = Math.random() * SEED_SCALE - 0.5 * SEED_SCALE
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

  timeTick(t: number, dt: number) {
    if (this.mode === 'constant') return
    if (this.mode === 'test') {
      this.testColors = []
      for (let i = 0; i < this.stripLength; i++) {
        let color = (i + 1) / this.stripLength
        color = i % 2 ? 1 - color : color
        color *= 255
        this.testColors[i] = [color, color, color]
      }
    } else if (this.mode === 'classic') {
      const speed = Math.sin(
        this.acceleration * CLASSIC_TIME_SCALE * t + this.seed
      )
      this.timeParam += this.morphRate * speed * CLASSIC_TIME_SCALE * dt
      this.positionParam = CLASSIC_TIME_SCALE * t * this.speed + 2 * this.seed
      this.positionDelta = (speed * CLASSIC_POSITION_SCALE) / this.width
    } else if (this.mode === 'fm') {
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
      this.sinceFlip += dt
      if (this.sinceFlip >= this.strobePeriod) {
        this.sinceFlip = 0
        this.on = !this.on
      }
    }
  }

  positionTick(t: number, dt: number, position: number): Rgb {
    if (this.strobe && !this.on) return [0, 0, 0]
    if (this.mode === 'test') return this.testColors[position]
    if (this.mode === 'constant') return this.rgb
    let level = 1
    if (this.mode === 'classic') {
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
      level = Math.pow(
        scaleSine(
          fm(
            this.timeParam +
              (FM_POSITION_SCALE / this.width) * position +
              this.seed,
            this.C,
            this.D,
            this.M
          )
        ),
        this.power
      )
    }
    return this.rgb.map((value) => value * level) as Rgb
  }
}

const blendColors = (blendMode: BlendMode, base: Rgb, blend: Rgb): Rgb => {
  if (blendMode === 'DEFAULT') {
    const difference =
      (blend.reduce((a, p) => a + p) - base.reduce((a, p) => a + p)) / 255
    if (difference <= 0) return base
    else
      return base.map(
        (value, index) => value + difference * blend[index]
      ) as Rgb
  } else {
    return base.map((sumValue, index) => {
      const value = blend[index]
      if (blendMode === 'AVERAGE') return (sumValue + value) / 2
      else if (blendMode === 'SUM') return sumValue + value
      else if (blendMode === 'MULTIPLY') return sumValue * value
      else if (blendMode === 'DODGE') return sumValue / (1 - value / 255)
      else if (blendMode === 'BURN') return (1 - value / 255) / sumValue
      else if (blendMode === 'REPLACE') return value > 0 ? value : sumValue
    }) as Rgb
  }
}

const isAfter = (date: Date, ruleTime: TimeTuple): boolean =>
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
