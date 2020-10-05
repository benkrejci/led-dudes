# led-dudes
Control RGB led strips with traveling and morphing "dudes" (fm sine waves). Supports SK9822 (e.g. Adafruit DotStar) and WS281(X) (e.g. Adafruit NeoPixel) right now. Tested on a Raspberry Pi Zero W with Adafruit DotStar strip via SPI as well as Adafruit NeoPixel strip via PWM & DMA on GPIO18.

## Config options
| Option | Required | Description |
| --- | --- | --- |
| ledType | yes | dotstar or SK9822, neopixel or ws281x |
| stripLength | yes | int total number of LEDs |
| schedule |  | list of times to be "on", see below for format |
| dudes |  | list of "dudes"; see [implementation](./led-dudes.js) and [examples](./config/) for details |

**Schedule item should be in form:**
```yml
state: ON
start: [h, m]
end: [h, m]
```
Where h is int hours (0 - 23) and m is int minutes (0 - 59)

## Usage
Only argument is config file
`node index.js config/halloween-dotstar.yml`

## Install
`yarn install # or npm install`

I use pm2 to start on boot:
```sh
yarn global add pm2 # or npm install -g pm2
pm2 startup # follow instructions
pm2 start --name led-dudes index.js -- config/halloween-dotstar.yml
pm2 save
```

Note that you will need to run as root if you use neopixel (WS281x) mode. For example:
```sh
sudo startup
sudo pm2 start --name led-dudes index.js -- config/halloween-neopixel.yml
sudo pm2 save
```

