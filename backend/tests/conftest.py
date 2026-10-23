import io
from fractions import Fraction

import av
import pytest
from PIL import Image


@pytest.fixture
def tiny_mp4():
    def make(seconds=1, audio=False):
        buffer = io.BytesIO()
        with av.open(buffer, mode='w', format='mp4') as output:
            stream = output.add_stream('libx264', rate=1)
            stream.width = stream.height = 16
            stream.pix_fmt = 'yuv420p'
            audio_stream = output.add_stream('aac', rate=8000) if audio else None
            for index in range(seconds):
                frame = av.VideoFrame(width=16, height=16, format='yuv420p')
                for plane in frame.planes:
                    plane.update(bytes([128]) * plane.buffer_size)
                frame.pts = index
                frame.time_base = Fraction(1, 1)
                for packet in stream.encode(frame):
                    output.mux(packet)
            for packet in stream.encode():
                output.mux(packet)
            if audio:
                frame = av.AudioFrame(format='fltp', layout='mono', samples=1024)
                frame.sample_rate = 8000
                for plane in frame.planes:
                    plane.update(bytes(plane.buffer_size))
                for packet in audio_stream.encode(frame):
                    output.mux(packet)
                for packet in audio_stream.encode():
                    output.mux(packet)
        return buffer.getvalue()
    return make


@pytest.fixture
def tiny_png():
    output = io.BytesIO()
    Image.new('RGB', (16, 16), '#c5f277').save(output, format='PNG')
    return output.getvalue()
