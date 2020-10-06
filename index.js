const fs = require('fs')
const path = require('path')
const YAML = require('yaml')

const argv = require('yargs')
    .usage('Usage: $0 [config-file]')
    .alias('d', 'dummy')
    .describe('d', 'Run terminal-simulated dummy LED strip instead of the real thing')
    .alias('s', 'ignoreSchedule')
    .describe('s', 'Disable schedule checking')
    .demandCommand(1)
    .argv

const ledDudes = require('./led-dudes')
const configPath = path.normalize(argv._[0])
if (!configPath || !fs.existsSync(configPath))
    throw new TypeError(`Unspecified or invalid config argument (should be config path): ${configPath}`)

let config
try {
    config = YAML.parse(fs.readFileSync(configPath, 'utf8'))
} catch (error) {
    console.error(`Error parsing config file ${configPath}:`, error)
    process.exit(0)
}

ledDudes.start(config, { dummyMode: argv.dummy, ignoreSchedule: argv.ignoreSchedule })
