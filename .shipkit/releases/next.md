# next (minor)

## Web panel

### Output widgets: relight a photo with its depth and normal maps
<!-- commit: 5bb5ed9 weight: feature -->
A workflow can now name a widget the web panel draws over its outputs. Tag the images (b.SaveImageWebsocket({ images }, { tag: 'depth' })) and list widget.relight({ image, depth, normal, albedo, roughness, metalness, specular }) in defineWorkflow({ widgets }): the panel shows the photo lit by a point light you drag over it, with the wheel for nearer or farther, shadows from the depth map and drifting light motes. The new example 17-relight runs a depth model, a normal model and Marigold material maps for it. The CLI and the terminal UI keep the tagged images as plain outputs.

![Output widgets: relight a photo with its depth and normal maps](space:release/1aa7dfc36cdb4f3fd795cd16b1f196210730c023f9b38531415a94e62797b575.mp4 "safe")
