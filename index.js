const fs = require('fs')
const YAML = require('yaml')

const ledDudes = require('./ledDudes')

const configPath = process.argv[2]
if (!configPath || !fs.existsSync(configPath))
    throw new TypeError(`Unspecified or invalid first argument (should be config path): ${configPath}`)

let config
try {
    config = YAML.parse(fs.readFileSync(configPath, 'utf8'))
} catch (error) {
    console.error(`Error parsing config file ${configPath}:`, error)
    process.exit(0)
}

ledDudes.start(config)
