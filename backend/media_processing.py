"""Bounded in-memory image/video inspection; no public URLs or temp assets."""
import io
import math
import warnings
import time
from collections import Counter

import av
from PIL import Image, UnidentifiedImageError

MAX_BYTES = 10 * 1024 * 1024
MAX_PIXELS = 20_000_000
Image.MAX_IMAGE_PIXELS = MAX_PIXELS


class InvalidMedia(ValueError):
    pass


def inspect_image(data, strict=True):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                if strict and image.format not in ('JPEG', 'PNG'):
                    raise InvalidMedia('Compliance analysis supports JPEG and PNG images. Export this creative as JPEG or PNG.')
                if image.width * image.height > MAX_PIXELS or getattr(image, 'n_frames', 1) != 1:
                    raise InvalidMedia('Use a still image with at most 20 million pixels; animated images are not supported for review.')
                image.load()
                rgb = image.convert('RGB')
                sample = rgb.copy()
                sample.thumbnail((128, 128), Image.Resampling.NEAREST)
                raw = sample.tobytes()
                counts = Counter(zip(raw[0::3], raw[1::3], raw[2::3]))
                palette = [{'hex': '#%02x%02x%02x' % color, 'sample_percent': round(100 * count / (sample.width * sample.height), 2)}
                           for color, count in counts.most_common(6)]
                return {'width': image.width, 'height': image.height, 'sampled_palette': palette}
    except InvalidMedia:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise InvalidMedia('Could not decode this image safely. Upload a valid JPEG or PNG.') from None


def inspect_video(data):
    try:
        with av.open(io.BytesIO(data), mode='r') as container:
            if not any(name in container.format.name.split(',') for name in ('mov', 'mp4')):
                raise InvalidMedia('Video review supports MP4. Export this creative as MP4.')
            if len(container.streams.video) != 1 or len(container.streams.audio) > 1 or container.streams.subtitles:
                raise InvalidMedia('Export an MP4 with one video track and at most one audio track. Burn any subtitle tracks into the video so they can be reviewed.')
            stream = next(iter(container.streams.video), None)
            if stream is None or stream.width * stream.height > 3840 * 2160:
                raise InvalidMedia('Use an MP4 with a video track, at most 3840 × 2160 pixels.')
            dimensions = (stream.width, stream.height)
            started = time.monotonic()
            reported = float(container.duration / av.time_base) if container.duration else 0
            if not math.isfinite(reported) or reported > 120:
                raise InvalidMedia('Video review supports at most two minutes (120 seconds). Trim or split the video explicitly before uploading.')
            # Validate the full timeline, not just a filename or unreliable metadata.
            frames, last_end = 0, 0.0
            for frame in container.decode(stream):
                frames += 1
                if frames > 20000 or frame.time is None or time.monotonic() - started > 25:
                    raise InvalidMedia('Could not establish a reliable video timeline. Re-export a constant-timeline MP4.')
                duration = float(frame.duration * frame.time_base) if frame.duration else 0
                last_end = max(last_end, float(frame.time) + duration)
                if last_end > 120.05:
                    raise InvalidMedia('Video review supports at most two minutes (120 seconds). Trim or split it before uploading.')
            duration = max(reported, last_end)
            if not frames or not math.isfinite(duration) or duration <= 0 or duration > 120.05:
                raise InvalidMedia('Could not decode a valid MP4 lasting at most 120 seconds.')
            has_audio = bool(container.streams.audio)
        if has_audio:
            # Corrupt/unreadable audio must not be silently treated as a silent ad.
            with av.open(io.BytesIO(data), mode='r') as audio_container:
                audio_samples = 0
                for frame in audio_container.decode(audio=0):
                    audio_samples += frame.samples
                    if frame.time is None or float(frame.time) + frame.samples / frame.sample_rate > 120.05 or audio_samples > 120 * 192000 * 2:
                        raise InvalidMedia('Audio duration exceeds the supported video limit.')
                if not audio_samples:
                    raise InvalidMedia('The video has an unreadable audio track. Re-export the video with valid audio.')
        # Respect 128-frame guidance above 720p, up to 256 for lower resolutions.
        frame_limit = 128 if max(dimensions) > 1280 or min(dimensions) > 720 else 256
        return {'duration_seconds': round(duration, 3), 'has_audio': has_audio,
                'sample_frames': min(frame_limit, max(1, math.ceil(duration))),
                'sampling_note': 'Representative frames across the full clip; brief scenes between sampled frames may be missed.'}
    except InvalidMedia:
        raise
    except Exception:
        raise InvalidMedia('Could not decode this MP4 or its audio. Re-export a valid MP4 and retry.') from None
