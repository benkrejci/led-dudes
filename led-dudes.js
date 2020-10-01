const { getLedController } = require('./led-controller')

const GAMMA_DEFAULT = 2.2
const POWER_DEFAULT = 2
const SPEED_DEFAULT = 1
const MORPH_RATE_DEFAULT = 5
const ACCELERATION_DEFAULT = 1
const WIDTH_DEFAULT = 3
const STROBE_PERIOD_DEFAULT = 1000 / 60
const BLEND_MODE_DEFAULT = 'SUM'
const DUDES_INTERVAL_DELAY = 0
const SCHEDULE_INTERVAL_DELAY = 10 * 1000

const TIME_SCALE = 1 / 7000
const POSITION_SCALE = 1
const SEED_SCALE = 1000

// This function improves the color accuracy somewhat by doing gamma correction
const normalize = (value, gamma) => Math.pow(value / 255, 1 / gamma) * 255

const oneSine = x => Math.max(0, Math.min(1, Math.sin(x) * 0.5 + 0.5))

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

    if (config.gamma === undefined) config.gamma = GAMMA_DEFAULT

    if (!config.dudes || !config.dudes.length) throw new TypeError('Missing or invalid dudes array')
    config.dudes.forEach(dude => {
        if (dude.power === undefined) dude.power = POWER_DEFAULT
        if (dude.speed === undefined) dude.speed = SPEED_DEFAULT
        if (dude.morphRate === undefined) dude.morphRate = MORPH_RATE_DEFAULT
        if (dude.acceleration === undefined) dude.acceleration = ACCELERATION_DEFAULT
        if (dude.width === undefined) dude.width = WIDTH_DEFAULT
        if (dude.blendMode === undefined) dude.blendMode = BLEND_MODE_DEFAULT
    
        if (dude.constant) return
    
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

function startDudes(config, controller) {
    let frames = 0
    let sinceFpsPrint = 0
    let tLast = +new Date() * TIME_SCALE
 
    return setInterval(() => {
        const t = +new Date()
        const dt = t - tLast
        tLast = t
        config.dudes.forEach(dude => {
            if (dude.constant) return
            if (dude.test) return
            const speed = Math.sin(dude.acceleration * TIME_SCALE * t + dude.seed)
            dude.timeParam += dude.morphRate * speed * TIME_SCALE * dt
            dude.positionParam = TIME_SCALE * t * dude.speed + 2 * dude.seed
            dude.positionDelta = speed * POSITION_SCALE / dude.width
            if (dude.strobe) {
                dude.sinceFlip += dt
                if (dude.sinceFlip >= dude.strobePeriod) {
                    dude.sinceFlip = 0
                    dude.on = !dude.on
                }
            }
        })
    
        for (let position = 0; position < config.stripLength; position++) {
            const color = config.dudes
                .map(dude => {
                    if (dude.test) {
                        const mod = position % 2
                        return [dude, mod ? dude.rgb : dude.rgb2]
                    }
                    if (dude.strobe && !dude.on) return [dude, [0,0,0]]
                    if (dude.constant) return [dude, dude.rgb]
                    dude.positionParam += dude.positionDelta
                    let level = oneSine(0.2 * dude.timeParam + dude.positionParam) *
                                oneSine(dude.timeParam + 0.2 * dude.positionParam)
                    level = Math.pow(level, dude.power)
                    if (dude.scale || dude.offset) {
                        level = level * dude.scale + dude.offset
                        level = Math.max(0, Math.min(1, level))
                    }
                    return [dude, dude.rgb.map(value => value * level)]
                })
                .reduce((rgbSum, [dude, rgb]) => blendColors(dude.blendMode, rgbSum, rgb), [0,0,0])
                .map(value => normalize(Math.max(0, Math.min(255, value)), config.gamma))
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

