# Bundled example input images

Default inputs for the i2i/i2v examples — they ship in the npm tarball so every example runs out of the box. The exact pixel size is in each filename.

Source: [picsum.photos](https://picsum.photos), which serves Unsplash-sourced photos, free to use. Fetched and re-encoded (jpeg q80, metadata stripped) by `scripts/fetch-example-images.ts` — the manifest in that script is the source of truth; regeneration is deliberate (`bun run examples:images`).

| file                  | size      | picsum id                                  | author                                                       |
| --------------------- | --------- | ------------------------------------------ | ------------------------------------------------------------ |
| `dog_512x512.jpg`     | 512×512   | [237](https://picsum.photos/id/237/info)   | [André Spieker](https://unsplash.com/photos/8wTPqxlnKM4)     |
| `lioness_768x768.jpg` | 768×768   | [1074](https://picsum.photos/id/1074/info) | [Samuel Scrimshaw](https://unsplash.com/photos/sseiVD2XsOk)  |
| `bear_1024x1024.jpg`  | 1024×1024 | [433](https://picsum.photos/id/433/info)   | [Thomas Lefebvre](https://unsplash.com/photos/aRXPJnXQ9lU)   |
| `walrus_1344x768.jpg` | 1344×768  | [1084](https://picsum.photos/id/1084/info) | [Jay Ruzesky](https://unsplash.com/photos/h13Y8vyIXNU)       |
| `deer_768x1344.jpg`   | 768×1344  | [1003](https://picsum.photos/id/1003/info) | [E+N Photographies](https://unsplash.com/photos/GYumuBnTqKc) |
| `pug_200x300.jpg`     | 200×300   | [1025](https://picsum.photos/id/1025/info) | [Matthew Wiebe](https://unsplash.com/photos/U5rMrSI7Pn4)     |
