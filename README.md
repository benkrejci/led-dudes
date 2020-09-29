# led-dudes
Control (right now only DotStar) RGB led strips with traveling and morphing "dudes" (fm sine waves). Used on a Raspberry Pi Zero W with Adafruit DotStar via SPI.

## Usage
Only argument is config file
`node index.js config/halloween.yml`

## Install
`yarn install`

I use pm2 to start on boot:
```sh
yarn global add pm2
pm2 startup # follow instructions
pm2 start --name led-dudes index.js -- config/halloween.yml
```

