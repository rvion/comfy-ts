# comfy-ts

[![CI](https://github.com/rvion/comfy-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/rvion/comfy-ts/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/%40cushy%2Fcomfy-ts.svg)](https://badge.fury.io/js/%40cushy%2Fcomfy-ts)

Full-featured TypeScript solution to work with generative-AI and ComfyUI.
Best-in-class, type-safe, easy to use, production-ready, and battle-tested.

🔴 DISCLAIMER: This (`comfy-ts`) package is beeing extracted from CushyStudio. Extraction is Unfinished 🔴

## Installation

```bash
yarn add comfy-ts
npm install comfy-ts
pnpm install comfy-ts
```

## Simple example

```ts
import { ComfyTS } from '../state'

const comfy = new ComfyTS()

// 1. create a host
const host = comfy.defineHost({ id: 'windows-1', hostname: 'localhost', port: 8085, useHttps: false, })

// 2. codegen types for models, custom-nodes, ...
await host.fetchAndUpdateSchema()

// 3. create a workflow
const workflow = host.createEmptyWorkflow({ id: 'simple' })

// 4. build your workflow
const b = workflow.builder
const ckpt = b.CheckpointLoaderSimple({ ckpt_name: 'revAnimated_v122.safetensors' })
const positive = b.CLIPTextEncode({ clip: ckpt, text: 'a house' })
const negative = b.CLIPTextEncode({ clip: ckpt, text: 'bad' })
const latent_image = b.EmptyLatentImage({ width: 512, height: 512, batch_size: 1 })
const images = b.VAEDecode({
   vae: ckpt,
   samples: b.KSampler({
      model: ckpt,
      sampler_name: 'ddim',
      scheduler: 'ddim_uniform',
      positive,
      negative,
      latent_image,
   }),
})
b.PreviewImage({ images: images })

// 5. execute your workflow
await workflow.PROMPT()
```

## Scope

This used to work in CushyStudio and this repo aims to bring those feature to life, clean them, and polish them.

- ✅ configure ComfyUI
  - ✅ install custom nodes
  - ✅ install models

- ✅ generate a fully type-safe SDK with
  - all nodes and their properties, all possible values, etc.

- ✅ build workflows programmatic
  - ✅ state of the art API with lots of clever helper and utilities

- ✅ run workflows
  - retrieve latent preview
  - retrieve image and other outputs
  - run workflow in parallel

- ✅ Maintain a type-safe up-to-date community Library of all known nodes to help make workflows
   - see [KnownComfyCustomNodeName](./src/manager/generated/KnownComfyCustomNodeName.ts)
   - see [KnownComfyPluginTitle](./src/manager/generated/KnownComfyPluginTitle.ts)
   - see [KnownComfyPluginURL](./src/manager/generated/KnownComfyPluginURL.ts)
   - see [KnownModel_Base](./src/manager/generated/KnownModel_Base.ts)
   - see [KnownModel_FileName](./src/manager/generated/KnownModel_FileName.ts)
   - see [KnownModel_Name](./src/manager/generated/KnownModel_Name.ts)
   - see [KnownModel_SavePath](./src/manager/generated/KnownModel_SavePath.ts)
   - see [KnownModel_Type](./src/manager/generated/KnownModel_Type.ts)


## Other Comfy-related packages:

🔴 DISCLAIMER: This (`comfy-ts`) package is beeing extracted from CushyStudio. Extraction is Unfinished 🔴

- [@saintno/comfyui-sdk](https://www.npmjs.com/package/@saintno/comfyui-sdk)
  - API looks very polished
  - lots of cool features
  - but unsafe workflow building
  - no type-safe registry

- [comfyui-bun-client](https://github.com/KaruroChori/comfyui-bun-client/tree/master)
  - very close to what I built in CushyStudio
  - codegen less functional, less features, no type-safe registry, etc.
  - not published on npm