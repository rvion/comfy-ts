# Bundled example media

Default inputs for the examples that take an audio or a video file. They ship in the npm tarball, so these examples run out of the box. All are synthetic (ffmpeg test sources, or a voice invented by a TTS model), so no license question applies.

| file                     | what                                       | made with                                                                                                                  |
| ------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `testsrc_256x256_3s.mp4` | 3 s, 256×256, 12 fps, h264, no audio track | `ffmpeg -f lavfi -i "testsrc2=size=256x256:rate=12:duration=3" -c:v libx264 -pix_fmt yuv420p -crf 30 -movflags +faststart` |
| `sine_440hz_3s.flac`     | 3 s, 440 Hz sine at 30% volume, 22.05 kHz  | `ffmpeg -f lavfi -i "sine=frequency=440:duration=3:sample_rate=22050" -af "volume=0.3" -c:a flac`                          |
| `voice_en_6s.flac`       | 6.4 s of English speech, 24 kHz mono, the default voice of example 15 | Qwen3-TTS 1.7B VoiceDesign (Apache 2.0), instruction « a calm, warm adult narrator in his thirties, clear diction, neutral American English accent, steady medium pace », text « This is a short sample of my voice. Clone it, and I can read any text you give me, in many languages. », seed 7 |
