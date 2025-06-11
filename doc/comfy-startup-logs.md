for future reference,
as of 2025-06-11, my comfy starup logs look like this:

```
user@DESKTOP-IM18794 C:\Users\user>conda activate comfy-env

(comfy-env) user@DESKTOP-IM18794 C:\Users\user>comfy launch -- --port=8085 --listen=0.0.0.0
╭─────────────────────────────────  Update Available! ───────────────────────────────╮
│  Newer version of comfy-cli is available: 1.4.1.                                   │
│ Current version: 1.4.0                                                             │
│ Update by running: 'pip install --upgrade comfy-cli'                               │
╰────────────────────────────────────────────────────────────────────────────────────╯

Launching ComfyUI from: C:\Users\user\dev\confy-3\wsp1

[START] Security scan
[DONE] Security scan
## ComfyUI-Manager: installing dependencies done.
** ComfyUI startup time: 2025-06-10 21:48:28.927
** Platform: Windows
** Python version: 3.11.11 | packaged by Anaconda, Inc. | (main, Dec 11 2024, 16:34:19) [MSC v.1929 64 bit (AMD64)]
** Python executable: C:\Users\user\miniconda3\envs\comfy-env\python.exe
** ComfyUI Path: C:\Users\user\dev\confy-3\wsp1
** ComfyUI Base Folder Path: C:\Users\user\dev\confy-3\wsp1
** User directory: C:\Users\user\dev\confy-3\wsp1\user
** ComfyUI-Manager config path: C:\Users\user\dev\confy-3\wsp1\user\default\ComfyUI-Manager\config.ini
** Log path: C:\Users\user\dev\confy-3\wsp1\user\comfyui.log

Prestartup times for custom nodes:
   0.0 seconds: C:\Users\user\dev\confy-3\wsp1\custom_nodes\rgthree-comfy
   2.2 seconds: C:\Users\user\dev\confy-3\wsp1\custom_nodes\ComfyUI-Manager

Checkpoint files will always be loaded safely.
Total VRAM 24564 MB, total RAM 32544 MB
pytorch version: 2.7.0+cu126
Set vram state to: NORMAL_VRAM
Device: cuda:0 NVIDIA GeForce RTX 4090 : cudaMallocAsync
Using pytorch attention
Python version: 3.11.11 | packaged by Anaconda, Inc. | (main, Dec 11 2024, 16:34:19) [MSC v.1929 64 bit (AMD64)]
ComfyUI version: 0.3.39
ComfyUI frontend version: 1.20.7
[Prompt Server] web root: C:\Users\user\miniconda3\envs\comfy-env\Lib\site-packages\comfyui_frontend_package\static
Web extensions folder found at C:\Users\user\dev\confy-3\wsp1\web\extensions\ComfyLiterals
### Loading: ComfyUI-Impact-Pack (V8.15.3)
### Loading: ComfyUI-Impact-Subpack (V1.3.2)
[Impact Pack/Subpack] Using folder_paths to determine whitelist path: C:\Users\user\dev\confy-3\wsp1\user\default\ComfyUI-Impact-Subpack\model-whitelist.txt
[Impact Pack/Subpack] Ensured whitelist directory exists: C:\Users\user\dev\confy-3\wsp1\user\default\ComfyUI-Impact-Subpack
[Impact Pack] Wildcards loading done.
[Impact Pack/Subpack] Loaded 0 model(s) from whitelist: C:\Users\user\dev\confy-3\wsp1\user\default\ComfyUI-Impact-Subpack\model-whitelist.txt
[Impact Subpack] ultralytics_bbox: C:\Users\user\dev\confy-3\wsp1\models\ultralytics\bbox
[Impact Subpack] ultralytics_segm: C:\Users\user\dev\confy-3\wsp1\models\ultralytics\segm
Found LoRA roots:
 - C:/Users/user/dev/confy-3/wsp1/models/loras
Found checkpoint roots:
 - C:/Users/user/dev/confy-3/wsp1/models/checkpoints
 - C:/Users/user/dev/confy-3/wsp1/models/diffusers
 - C:/Users/user/dev/confy-3/wsp1/models/diffusion_models
 - C:/Users/user/dev/confy-3/wsp1/models/unet
Saved folder paths to settings.json
Metadata collection hooks installed for runtime values
ComfyUI Metadata Collector initialized
Example images path: None
Added static route /loras_static/root1/preview -> C:/Users/user/dev/confy-3/wsp1/models/loras
Added static route /checkpoints_static/root1/preview -> C:/Users/user/dev/confy-3/wsp1/models/checkpoints
Added static route /checkpoints_static/root2/preview -> C:/Users/user/dev/confy-3/wsp1/models/diffusers
Added static route /checkpoints_static/root3/preview -> C:/Users/user/dev/confy-3/wsp1/models/diffusion_models
Added static route /checkpoints_static/root4/preview -> C:/Users/user/dev/confy-3/wsp1/models/unet
### Loading: ComfyUI-Manager (V3.32.8)
[ComfyUI-Manager] network_mode: public
### ComfyUI Version: v0.3.39-7-g97f23b81 | Released on '2025-05-30'
[ComfyUI-Manager] default cache updated: https://raw.githubusercontent.com/ltdrdata/ComfyUI-Manager/main/alter-list.json
[ComfyUI-Manager] default cache updated: https://raw.githubusercontent.com/ltdrdata/ComfyUI-Manager/main/model-list.json
[ComfyUI-Manager] default cache updated: https://raw.githubusercontent.com/ltdrdata/ComfyUI-Manager/main/github-stats.json
[ComfyUI-Manager] default cache updated: https://raw.githubusercontent.com/ltdrdata/ComfyUI-Manager/main/custom-node-list.json
[ComfyUI-Manager] default cache updated: https://raw.githubusercontent.com/ltdrdata/ComfyUI-Manager/main/extension-node-map.json
C:\Users\user\miniconda3\envs\comfy-env\Lib\site-packages\timm\models\layers\__init__.py:48: FutureWarning: Importing from timm.models.layers is deprecated, please import via timm.layers
  warnings.warn(f"Importing from {__name__} is deprecated, please import via timm.layers", FutureWarning)
[ComfyUI-RMBG] v2.4.0 | 24 nodes Loaded
(pysssss:WD14Tagger) [DEBUG] Available ORT providers: TensorrtExecutionProvider, CUDAExecutionProvider, CPUExecutionProvider
(pysssss:WD14Tagger) [DEBUG] Using ORT providers: CUDAExecutionProvider, CPUExecutionProvider
[C:\Users\user\dev\confy-3\wsp1\custom_nodes\comfyui_controlnet_aux] | INFO -> Using ckpts path: C:\Users\user\dev\confy-3\wsp1\custom_nodes\comfyui_controlnet_aux\ckpts
[C:\Users\user\dev\confy-3\wsp1\custom_nodes\comfyui_controlnet_aux] | INFO -> Using symlinks: False
[C:\Users\user\dev\confy-3\wsp1\custom_nodes\comfyui_controlnet_aux] | INFO -> Using ort providers: ['CUDAExecutionProvider', 'DirectMLExecutionProvider', 'OpenVINOExecutionProvider', 'ROCMExecutionProvider', 'CPUExecutionProvider', 'CoreMLExecutionProvider']
DWPose: Onnxruntime with acceleration providers detected

[rgthree-comfy] Loaded 47 extraordinary nodes. 🎉


Import times for custom nodes:
   0.0 seconds: C:\Users\user\dev\confy-3\wsp1\custom_nodes\websocket_image_save.py
   0.0 seconds: C:\Users\user\dev\confy-3\wsp1\custom_nodes\comfyui-easy-padding
   0.0 seconds: C:\Users\user\dev\confy-3\wsp1\custom_nodes\comfy-cliption
   0.0 seconds: C:\Users\user\dev\confy-3\wsp1\custom_nodes\comfyui-clip-with-break
   0.0 seconds: C:\Users\user\dev\confy-3\wsp1\custom_nodes\masquerade-nodes-comfyui
   0.0 seconds: C:\Users\user\dev\confy-3\wsp1\custom_nodes\cg-use-everywhere
   0.0 seconds: C:\Users\user\dev\confy-3\wsp1\custom_nodes\comfyui-inpaint-cropandstitch
   0.0 seconds: C:\Users\user\dev\confy-3\wsp1\custom_nodes\ComfyLiterals
   0.0 seconds: C:\Users\user\dev\confy-3\wsp1\custom_nodes\civitai_comfy_nodes
   0.0 seconds: C:\Users\user\dev\confy-3\wsp1\custom_nodes\ComfyUI_HuggingFace_Downloader
   0.0 seconds: C:\Users\user\dev\confy-3\wsp1\custom_nodes\comfyui_ipadapter_plus
   0.0 seconds: C:\Users\user\dev\confy-3\wsp1\custom_nodes\comfyui-inpaint-nodes
   0.0 seconds: C:\Users\user\dev\confy-3\wsp1\custom_nodes\comfyui_essentials
   0.0 seconds: C:\Users\user\dev\confy-3\wsp1\custom_nodes\comfyui-wd14-tagger
   0.0 seconds: C:\Users\user\dev\confy-3\wsp1\custom_nodes\comfyui-sizefrompresets
   0.0 seconds: C:\Users\user\dev\confy-3\wsp1\custom_nodes\comfyui-kjnodes
   0.0 seconds: C:\Users\user\dev\confy-3\wsp1\custom_nodes\comfyui-image-saver
   0.0 seconds: C:\Users\user\dev\confy-3\wsp1\custom_nodes\comfyui-videohelpersuite
   0.1 seconds: C:\Users\user\dev\confy-3\wsp1\custom_nodes\comfyui_controlnet_aux
   0.1 seconds: C:\Users\user\dev\confy-3\wsp1\custom_nodes\comfyui-impact-pack
   0.1 seconds: C:\Users\user\dev\confy-3\wsp1\custom_nodes\rgthree-comfy
   0.1 seconds: C:\Users\user\dev\confy-3\wsp1\custom_nodes\comfyui-impact-subpack
   0.1 seconds: C:\Users\user\dev\confy-3\wsp1\custom_nodes\comfyui-lora-manager
   0.5 seconds: C:\Users\user\dev\confy-3\wsp1\custom_nodes\ComfyUI-Manager
   0.6 seconds: C:\Users\user\dev\confy-3\wsp1\custom_nodes\abg-comfyui
   1.3 seconds: C:\Users\user\dev\confy-3\wsp1\custom_nodes\comfyui-rmbg

Metadata collection hooks installed for runtime values
ComfyUI Metadata Collector initialized
LoRA Manager: All services initialized and background tasks scheduled
Starting server

Loaded lora cache from disk with 36 models in 0.00 seconds
Loaded checkpoint cache from disk with 12 models in 0.00 seconds
To see the GUI go to: http://0.0.0.0:8085
Recipe cache initialized in 0.00 seconds. Found 0 recipes
FETCH ComfyRegistry Data: 5/88
FETCH ComfyRegistry Data: 10/88
FETCH ComfyRegistry Data: 15/88
FETCH ComfyRegistry Data: 20/88
FETCH ComfyRegistry Data: 25/88
FETCH ComfyRegistry Data: 30/88
FETCH ComfyRegistry Data: 35/88
FETCH ComfyRegistry Data: 40/88
FETCH ComfyRegistry Data: 45/88
FETCH ComfyRegistry Data: 50/88
FETCH ComfyRegistry Data: 55/88
FETCH ComfyRegistry Data: 60/88
FETCH ComfyRegistry Data: 65/88
FETCH ComfyRegistry Data: 70/88
FETCH ComfyRegistry Data: 75/88
FETCH ComfyRegistry Data: 80/88
FETCH ComfyRegistry Data: 85/88
FETCH ComfyRegistry Data [DONE]
[ComfyUI-Manager] default cache updated: https://api.comfy.org/nodes
FETCH DATA from: https://raw.githubusercontent.com/ltdrdata/ComfyUI-Manager/main/custom-node-list.json [DONE]
[ComfyUI-Manager] All startup tasks have been completed.
```