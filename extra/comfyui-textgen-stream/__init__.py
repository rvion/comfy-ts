"""StreamTextGenerate: core TextGenerate, but you can watch it write.

ComfyUI's own TextGenerate blocks for the whole generation and publishes the answer once, at
the end. The protocol can already carry live text (PromptServer.send_progress_text, binary ws
frame type 3): the node simply never calls it.

The generation loop lives in comfy/text_encoders/llama.py and keeps its token list local, so
there is nothing to subscribe to. What IS reachable is `sample_token`, a method on the text
model called exactly once per generated token, returning the token it picked. Wrapping it for
the duration of one call gives every token as it is produced, at the cost of no reimplemented
sampling: the real loop still runs, unmodified.

Install: copy this folder into ComfyUI/custom_nodes/ and restart. Remove it by deleting the
folder, it patches nothing at import time and leaves no trace when the node is not running.
"""

from server import PromptServer
from comfy_api.latest import ComfyExtension, io
from typing_extensions import override


class StreamTextGenerate(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        sampling_options = [
            io.DynamicCombo.Option(
                key="on",
                inputs=[
                    io.Float.Input("temperature", default=0.7, min=0.01, max=2.0, step=0.000001),
                    io.Int.Input("top_k", default=64, min=0, max=1000),
                    io.Float.Input("top_p", default=0.95, min=0.0, max=1.0, step=0.01),
                    io.Float.Input("min_p", default=0.05, min=0.0, max=1.0, step=0.01),
                    io.Float.Input("repetition_penalty", default=1.05, min=0.0, max=5.0, step=0.01),
                    io.Int.Input("seed", default=0, min=0, max=0xFFFFFFFFFFFFFFFF),
                    io.Float.Input("presence_penalty", optional=True, default=0.0, min=0.0, max=5.0, step=0.01),
                ],
            ),
            io.DynamicCombo.Option(key="off", inputs=[]),
        ]
        return io.Schema(
            node_id="StreamTextGenerate",
            display_name="Generate Text (streaming)",
            category="text",
            search_aliases=["LLM", "stream"],
            inputs=[
                io.Clip.Input("clip"),
                io.String.Input("prompt", multiline=True, dynamic_prompts=True, default=""),
                io.Image.Input("image", optional=True),
                io.Audio.Input("audio", optional=True),
                io.Int.Input("max_length", default=512, min=1, max=32768),
                io.DynamicCombo.Input("sampling_mode", options=sampling_options, display_name="Sampling Mode"),
                io.Int.Input(
                    "stream_every",
                    default=4,
                    min=1,
                    max=256,
                    tooltip="publish the text so far every N tokens. 1 is token-by-token; decoding costs a little, so a few tokens per frame reads the same and wastes less.",
                ),
                io.Boolean.Input("thinking", optional=True, default=False),
                io.Boolean.Input("use_default_template", optional=True, default=True, advanced=True),
            ],
            outputs=[io.String.Output(display_name="generated_text")],
            hidden=[io.Hidden.unique_id],
        )

    @staticmethod
    def _find_sampler_owner(root, depth=4):
        """the nearest object exposing sample_token, following the encoder chain"""
        seen = []
        node = root
        for _ in range(depth):
            if node is None:
                break
            if callable(getattr(node, "sample_token", None)):
                return node
            seen.append(type(node).__name__)
            nxt = getattr(node, node.clip, None) if isinstance(getattr(node, "clip", None), str) else None
            node = nxt if nxt is not None else getattr(node, "transformer", None)
        print(f"[StreamTextGenerate] no sample_token under {' / '.join(seen)}, no live text for this model")
        return None

    @classmethod
    def execute(
        cls,
        clip,
        prompt,
        max_length,
        sampling_mode,
        stream_every=4,
        image=None,
        audio=None,
        thinking=False,
        use_default_template=True,
    ) -> io.NodeOutput:
        tokens = clip.tokenize(
            prompt,
            image=image,
            skip_template=not use_default_template,
            min_length=1,
            thinking=thinking,
            audio=audio,
        )

        do_sample = sampling_mode.get("sampling_mode") == "on"
        node_id = cls.hidden.unique_id

        # walk down to whoever OWNS sample_token rather than hardcoding the depth: the chain is
        # cond_stage_model, then getattr(it, it.clip), then .transformer today (comfy/sd1_clip.py), and
        # it has changed shape before. Searching by capability survives that; a wrong guess here
        # is silent, since a missing wrap just means no frames
        model = cls._find_sampler_owner(clip.cond_stage_model)
        original = getattr(model, "sample_token", None)

        produced = []

        def publish():
            if node_id is None:
                return
            try:
                PromptServer.instance.send_progress_text(clip.decode(produced), node_id)
            except Exception:
                # a failed publish must never kill a generation that is otherwise fine
                pass

        def sample_token(*args, **kwargs):
            token = original(*args, **kwargs)
            produced.append(token[0].item())
            if len(produced) % max(1, stream_every) == 0:
                publish()
            return token

        if original is not None:
            model.sample_token = sample_token
        try:
            generated_ids = clip.generate(
                tokens,
                do_sample=do_sample,
                max_length=max_length,
                temperature=sampling_mode.get("temperature", 1.0),
                top_k=sampling_mode.get("top_k", 50),
                top_p=sampling_mode.get("top_p", 1.0),
                min_p=sampling_mode.get("min_p", 0.0),
                repetition_penalty=sampling_mode.get("repetition_penalty", 1.0),
                presence_penalty=sampling_mode.get("presence_penalty", 0.0),
                seed=sampling_mode.get("seed", None),
            )
        finally:
            # restore even on an exception: the model object outlives this call and a leaked
            # wrapper would keep appending to a dead list on every later generation
            if original is not None:
                model.sample_token = original

        generated_text = clip.decode(generated_ids)
        if node_id is not None:
            publish()
        return io.NodeOutput(generated_text)


class StreamTextGenExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [StreamTextGenerate]


async def comfy_entrypoint() -> ComfyExtension:
    return StreamTextGenExtension()
