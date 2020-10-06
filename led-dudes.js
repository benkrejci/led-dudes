const { getLedController } = require('./led-controller')

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

const blendColors = (blendMode, base, blend) => {
    if (blendMode === 'DEFAULT') {
        const difference = (blend.reduce((a, p) => a + p) - base.reduce((a, p) => a + p)) / 255
        if (difference <= 0) return base
        else return base.map((value, index) => value + difference * blend[index])
    } else {
        return base.map((sumValue, index) => {
            const value = blend[index]
            if (blendMode === 'AVERAGE') return (sumValue + value) / 2
            else if (blendMode === 'SUM') return sumValue + value
            else if (blendMode === 'MULTIPLY') return sumValue * value
            else if (blendMode === 'DODGE') return sumValue / (1 - value/255)
            else if (blendMode === 'BURN') return (1 - value/255) / sumValue
            else if (blendMode === 'REPLACE') return value > 0 ? value : sumValue
        })
    }
}

exports.start = (config) => {
    const controller = getLedController(config)

    if (!config.dudes || !config.dudes.length) throw new TypeError('Missing or invalid dudes array')
    config.dudes.forEach(dude => {
        if (dude.mode === undefined) dude.mode = MODE_DEFAULT
        if (dude.power === undefined) dude.power = POWER_DEFAULT
        if (dude.speed === undefined) dude.speed = SPEED_DEFAULT
        if (dude.morphRate === undefined) dude.morphRate = MORPH_RATE_DEFAULT
        if (dude.acceleration === undefined) dude.acceleration = ACCELERATION_DEFAULT
        if (dude.width === undefined) dude.width = WIDTH_DEFAULT
        if (dude.blendMode === undefined) dude.blendMode = BLEND_MODE_DEFAULT
    
        if (dude.mode === 'constant') return
        if (dude.mode === 'classic') {
        } else if (dude.mode === 'fm') {
            dude.C = 0.59
            dude.M = 3.7
        }

        dude.seed = Math.random() * SEED_SCALE - 0.5 * SEED_SCALE
        dude.timeParam = 0

        if (dude.strobe) {
            if (dude.strobePeriod === undefined) dude.strobePeriod = STROBE_PERIOD_DEFAULT
            dude.sinceFlip = 0
        }
    })

    let dudesInterval = null
    let scheduleInterval = null
    if (!config.schedule) {
        dudesInterval = startDudes(config, controller)
    } else {
        let currentScheduleRule = null
        scheduleInterval = setInterval(() => {
            const now = new Date()
            if (currentScheduleRule === null) {
                config.schedule.every(rule => {
                    if (isAfter(now, rule.start) && !isAfter(now, rule.end)) {
                        dudesInterval = startDudes(config, controller)
                        currentScheduleRule = rule
                    } else {
                        return true
                    }
                })
            } else if (dudesInterval !== null && isAfter(now, currentScheduleRule.end)) {
                clearInterval(dudesInterval)
                controller.off()
                dudesInterval = null
                currentScheduleRule = null
            }
        }, SCHEDULE_INTERVAL_DELAY)
    }

    ;['SIGTERM', 'SIGINT'].forEach(event => process.on(event, () => {
        console.log(`Caught ${event}, exiting`)
        if (dudesInterval !== null) clearInterval(dudesInterval)
        if (scheduleInterval !== null) clearInterval(scheduleInterval)
        controller.off()
        process.exit(1)
    }))
}

function isAfter(date, ruleTime) {
    return date.getHours() == ruleTime[0] ?
             date.getMinutes() >= ruleTime[1]
           : date.getHours() > ruleTime[0]
}

const scaleSine = (x, min = 0, max = 1) => (Math.sin(x) * 0.5 + 0.5) * (max - min) + min
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
const fm = (x, C, D, M) => Math.sin(C * x + D * Math.sin(M * x))

function startDudes(config, controller) {
    let frames = 0
    let sinceFpsPrint = 0
    let tLast = +new Date() * CLASSIC_TIME_SCALE
 
    return setInterval(() => {
        const t = +new Date()
        const dt = t - tLast
        tLast = t
        config.dudes.forEach((dude, index) => {
            if (dude.mode === 'constant') return
            if (dude.mode === 'test') {
                dude.testColors = []
                for (let i = 0; i < config.stripLength; i++) {
                    let color = (i + 1) / config.stripLength
                    color = i % 2 ? 1 - color : color
                    color *= 255
                    dude.testColors[i] = [color, color, color]
                }
            } else if (dude.mode === 'classic') {
                const speed = Math.sin(dude.acceleration * CLASSIC_TIME_SCALE * t + dude.seed)
                dude.timeParam += dude.morphRate * speed * CLASSIC_TIME_SCALE * dt
                dude.positionParam = CLASSIC_TIME_SCALE * t * dude.speed + 2 * dude.seed
                dude.positionDelta = speed * CLASSIC_POSITION_SCALE / dude.width
                if (dude.strobe) {
                    dude.sinceFlip += dt
                    if (dude.sinceFlip >= dude.strobePeriod) {
                        dude.sinceFlip = 0
                        dude.on = !dude.on
                    }
                }
            } else if (dude.mode === 'fm') {
                dude.timeParam = dude.speed * (fm(FM_TIME_SCALE * dude.morphRate * t + 7 * dude.seed, dude.C, 1, dude.M) + FM_TIME_SCALE * t)
                dude.D = scaleSine(Math.sin(FM_TIME_SCALE *2* dude.morphRate * t + 3 * dude.seed), 0.6, 3)
            }
        })
    
        for (let position = 0; position < config.stripLength; position++) {
            const color = config.dudes
                .map(dude => {
                    if (dude.strobe && !dude.on) return [dude, [0,0,0]]
                    if (dude.mode === 'test') return [dude, dude.testColors[position]]
                    if (dude.mode === 'constant') return [dude, dude.rgb]
                    let level = 1
                    if (dude.mode === 'classic') {
                        dude.positionParam += dude.positionDelta
                        level = scaleSine(0.2 * dude.timeParam + dude.positionParam) *
                                scaleSine(dude.timeParam + 0.2 * dude.positionParam)
                        level = Math.pow(level, dude.power)
                        if (dude.scale || dude.offset) {
                            level = level * dude.scale + dude.offset
                            level = Math.max(0, Math.min(1, level))
                        }
                    } else if (dude.mode === 'fm') {
                        level = Math.pow(scaleSine(fm(dude.timeParam + FM_POSITION_SCALE / dude.width * position + dude.seed, dude.C, dude.D, dude.M)), dude.power)
                    }
                    return [dude, dude.rgb.map(value => value * level)]
                })
                .reduce((rgbSum, [dude, rgb]) => blendColors(dude.blendMode, rgbSum, rgb), [0,0,0])
                .map(value => Math.max(0, Math.min(255, value)))
            controller.setPixel(position, ...color)
        }
        frames++
        sinceFpsPrint += dt
        if (sinceFpsPrint > 1000) {
            console.log(`fps: ${frames/sinceFpsPrint*1000}`)
            frames = 0
            sinceFpsPrint = 0
        }
        controller.update()
    }, config.intervalDelay || DUDES_INTERVAL_DELAY)
}
