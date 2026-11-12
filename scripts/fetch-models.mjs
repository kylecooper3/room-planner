// Downloads the ML model files into public/models/<model id>/ so the desktop (Tauri) build never needs the network.
// The list is exactly what transformers.js 4.3.2 requests for the loads in src/photo/ml.ts (checked by recording its
// network requests). Files already present are kept. Usage: node scripts/fetch-models.mjs
import { createWriteStream, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const FILES = {
  'BritishWerewolf/U-2-Netp': ['config.json', 'onnx/model.onnx'],
  'Xenova/clip-vit-base-patch32': ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'preprocessor_config.json', 'onnx/model_quantized.onnx'],
};

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models');
for (const [model, files] of Object.entries(FILES)) {
  for (const f of files) {
    const dest = join(out, model, f);
    if (existsSync(dest)) continue;
    const url = `https://huggingface.co/${model}/resolve/main/${f}`;
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`fetch-models: ${url} -> HTTP ${res.status}`);
    mkdirSync(dirname(dest), { recursive: true });
    // Write to a temp name first so an interrupted download is never mistaken for a complete file.
    await pipeline(Readable.fromWeb(res.body), createWriteStream(dest + '.part'));
    renameSync(dest + '.part', dest);
    console.log(`fetch-models: ${model}/${f}`);
  }
}
console.log('fetch-models: all model files present in public/models');
