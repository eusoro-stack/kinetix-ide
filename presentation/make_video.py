import os
import imageio
from PIL import Image
import numpy as np

# Directory of slides
slides_dir = os.path.join(os.path.dirname(__file__), 'slides')
output_path = os.path.join(os.path.dirname(__file__), 'slideshow.mp4')

slides = ['slide1.png', 'slide2.png', 'slide3.png', 'slide4.png', 'slide5.png']

# Duration of each slide (in seconds)
slide_duration = 3
# Frame rate of output video (frames per second)
fps = 5

total_frames_per_slide = slide_duration * fps

print("Starting video generation...")
writer = imageio.get_writer(output_path, fps=fps, codec='libx264', format='FFMPEG')

for slide in slides:
    slide_path = os.path.join(slides_dir, slide)
    if os.path.exists(slide_path):
        print(f"Processing slide: {slide}")
        img = Image.open(slide_path)
        if img.mode != 'RGB':
            img = img.convert('RGB')
        
        # Ensure dimensions are divisible by 2 (required for H.264 video encoding)
        width, height = img.size
        new_width = width if width % 2 == 0 else width - 1
        new_height = height if height % 2 == 0 else height - 1
        if new_width != width or new_height != height:
            img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
            
        img_np = np.array(img)
        
        # Write frames for the duration of the slide
        for _ in range(total_frames_per_slide):
            writer.append_data(img_np)
    else:
        print(f"Slide not found: {slide_path}")

writer.close()
print(f"Video generated successfully at: {output_path}")
