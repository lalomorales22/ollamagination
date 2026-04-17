
<img width="1536" height="1024" alt="ChatGPT Image Apr 17, 2026, 04_05_18 PM" src="https://github.com/user-attachments/assets/03b87ddc-d6fb-4703-b1b2-7fb3b5535d4c" />

# OLLAMAGINATION
**AI Image Generation Gallery** powered by [Ollama](https://ollama.com) -- create, curate, and animate AI-generated art entirely on your local machine.

---

## Features

### Create Studio
Generate images one at a time using any Ollama image model. Write your own prompt or use the built-in **prompt enhancer** (powered by a chat model) to add composition, lighting, color, and mood details automatically. Generate **variations** of any image with a single click.

### 140 Style Presets
Choose from 140 curated art style presets across 12 categories:

| Category | Examples |
|---|---|
| **Classical & Fine Art** | Oil Painting, Watercolor, Fresco, Gouache |
| **Art Movements** | Impressionism, Surrealism, Cubism, Pop Art, Bauhaus |
| **Drawing & Illustration** | Pencil Sketch, Charcoal, Ink Wash, Botanical |
| **Digital & Modern** | Concept Art, Low Poly, Pixel Art, 3D Render |
| **Photography Styles** | Macro, Long Exposure, Cinematic, Film Grain |
| **Cultural & Traditional** | Ukiyo-e, Persian Miniature, Celtic, Mandala |
| **Comics & Animation** | Comic Book, Manga, Anime, Chibi, Webtoon |
| **Retro & Aesthetic** | Synthwave, Vaporwave, Y2K, Gothic, Cottagecore |
| **Sci-Fi & Fantasy** | Cyberpunk, Steampunk, Solarpunk, Dark Fantasy |
| **Texture & Material** | Stained Glass, Woodcut, Origami, Embroidery |
| **Special Effects** | Glitch Art, Neon Glow, Holographic, Fractal |
| **Consciousness & Spiritual** | Zen, Sacred Geometry, Visionary Art, Tarot Card |

### Auto Mode
Set it and forget it. Configure an image model, a chat model, style preferences, a theme, include/exclude keywords, and a target count -- then let Ollamagination generate a collection overnight. Each prompt is uniquely crafted by the chat model so no two images are alike. Progress streams in real-time via SSE so you can watch or walk away.

### Comic Studio
Create multi-page comic books from a single theme. Pick a title, style, and page count and the chat model writes a full story outline (scene descriptions + captions), then the image model renders each page. Comics are saved with metadata so you can revisit them in the gallery.

### Editor (Animated GIF Creator)
Select images from your gallery, arrange them as frames, set per-frame delay timing, preview the animation, and export as an animated GIF. The GIF encoder runs server-side with automatic palette quantization and frame resizing.

### Gallery
Browse, search, and manage everything you've created -- single images, auto-generated collections, and comic books. Favorite the ones you love, delete the ones you don't. All images are stored locally in the `gallery/` directory.

### Generation Queue
All image generation requests flow through a single queue so Ollama is never overloaded. A live queue status bar (SSE-powered) shows what's generating and what's waiting, across all modes.

### Duplicate Detection
Prompts are hashed and tracked so you never accidentally generate the same image twice.

---

## Prerequisites

- **[Node.js](https://nodejs.org/)** v18 or later
- **[Ollama](https://ollama.com)** installed and running locally on the default port (`11434`)
- At least one **image generation model** pulled in Ollama (e.g. `gemma3` or any model that supports image output)
- A **chat model** for prompt enhancement and auto/comic modes (e.g. `llama3`, `mistral`, `gemma3`)

---

## Installation

```bash
git clone https://github.com/lalomorales22/ollamagination.git
cd ollamagination
npm install
```

---

## Running

1. Make sure Ollama is running:
   ```bash
   ollama serve
   ```

2. Pull the models you want to use (if you haven't already):
   ```bash
   ollama pull x/z-image-turbo:latest
   ollama pull x/flux2-klein:4b
   ollama pull x/flux2-klein:9b
   ```

3. Start Ollamagination:
   ```bash
   npm start
   ```

4. Open your browser to **[http://localhost:3333](http://localhost:3333)**

The app runs on port `3333` by default.

---

## Project Structure

```
ollamagination/
├── server.js            # Express backend -- Ollama API proxy, queue, GIF export, SSE
├── package.json
├── public/
│   ├── index.html       # Single-page app UI
│   ├── css/
│   │   └── styles.css
│   └── js/
│       ├── app.js       # Frontend application logic
│       └── presets.js   # 140 style preset definitions
├── gallery/             # Generated images (auto-created)
│   ├── images/          # Single image generations
│   ├── collections/     # Auto mode collections
│   ├── comics/          # Comic book pages + metadata
│   └── animations/      # Exported GIFs
└── data/
    ├── gallery.json     # Gallery metadata
    └── history.json     # Prompt history for duplicate detection
```

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/models` | List available Ollama models |
| `POST` | `/api/generate/image` | Generate a single image |
| `POST` | `/api/generate/variation` | Generate a variation of a prompt |
| `POST` | `/api/generate/text` | Chat completion via Ollama |
| `POST` | `/api/enhance-prompt` | Enhance a prompt with a chat model |
| `GET` | `/api/gallery` | List gallery items (filter by `?type=`) |
| `DELETE` | `/api/gallery/:id` | Delete a gallery item |
| `POST` | `/api/gallery/:id/favorite` | Toggle favorite on an item |
| `POST` | `/api/export/gif` | Export frames as animated GIF |
| `POST` | `/api/auto/start` | Start an auto generation session |
| `POST` | `/api/auto/stop` | Stop the current auto session |
| `GET` | `/api/auto/events` | SSE stream for auto mode progress |
| `POST` | `/api/comic/start` | Start a comic generation session |
| `POST` | `/api/comic/stop` | Stop the current comic session |
| `GET` | `/api/comic/events` | SSE stream for comic progress |
| `GET` | `/api/queue/status` | Current queue status |
| `GET` | `/api/queue/events` | SSE stream for queue updates |
| `GET` | `/api/history` | Prompt generation history |
| `GET` | `/api/stats` | Gallery and generation statistics |

---

## Tech Stack

- **Backend:** Node.js, Express 5
- **Frontend:** Vanilla HTML/CSS/JavaScript (no framework, no build step)
- **Image Model API:** Ollama (local)
- **GIF Encoding:** [omggif](https://www.npmjs.com/package/omggif)
- **PNG Decoding:** [pngjs](https://www.npmjs.com/package/pngjs)
- **Real-time Updates:** Server-Sent Events (SSE)

---

## License

MIT

---

## Author

Built by [Lalo Morales](https://github.com/lalomorales22)
